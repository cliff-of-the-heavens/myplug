import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { cached, invalidate } from "./cache.server";
import { addDays, today } from "./dates";
import { MAX_AD_MS, MAX_EVENTS, type TrackBatch } from "./analytics";
import { getSettings, intSetting, setSettings } from "./settings.server";
import { isUuid } from "./utils";

const { analyticsDaily, analyticsMonthly, analyticsVisitors, visitorStoreMonthly, adCampaigns, stores, products, users } = schema;

// ---------------------------------------------------------------- settings

export type AnalyticsSettings = { enabled: boolean; dailyDays: number; visitorMonths: number; monthlyMonths: number };

export async function getAnalyticsSettings(): Promise<AnalyticsSettings> {
  const s = await getSettings();
  return {
    enabled: (s.analytics_enabled ?? "true") === "true",
    dailyDays: intSetting(s, "analytics_daily_days", 90, 7), // day-by-day detail, then rolled into months
    visitorMonths: intSetting(s, "analytics_visitor_months", 12, 1), // who frequents which stores
    monthlyMonths: intSetting(s, "analytics_monthly_months", 36, 1), // monthly summaries
  };
}

export async function saveAnalyticsSettings(v: AnalyticsSettings) {
  const clamp = (n: number, min: number, max: number) => String(Math.min(max, Math.max(min, Math.round(n) || min)));
  await setSettings({
    analytics_enabled: String(v.enabled),
    analytics_daily_days: clamp(v.dailyDays, 7, 730),
    analytics_visitor_months: clamp(v.visitorMonths, 1, 60),
    analytics_monthly_months: clamp(v.monthlyMonths, 1, 120),
  });
  invalidate("analytics-on");
}

/** Whether analytics is switched on (cached for a minute; the root loader passes it to the browser tracker). */
export const analyticsOn = () => cached("analytics-on", 60_000, async () => (await getAnalyticsSettings()).enabled);

const BOT = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|curl|wget|python|http-client|facebookexternalhit|whatsapp/i;

const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

// ---------------------------------------------------------------- recording

/**
 * Records one batch of browser events as a few counter updates (never one row per view):
 * at most one multi-row upsert into the daily counters, one for "who visits which store", and
 * one to note a new unique visitor. Bots and disabled analytics cost nothing.
 */
export async function recordBatch(batch: TrackBatch, ctx: { userAgent: string | null; userId: string | null }) {
  if (!(await analyticsOn())) return;
  if (!ctx.userAgent || BOT.test(ctx.userAgent)) return;
  const visitor = typeof batch.v === "string" && /^[\w-]{8,64}$/.test(batch.v) ? batch.v : null;
  if (!visitor || !Array.isArray(batch.e)) return;
  const day = today();

  const counters = new Map<string, { metric: string; subject: string; count: number; ms: number }>();
  const add = (metric: string, subject: string, count: number, ms = 0) => {
    const k = `${metric}|${subject}`;
    const c = counters.get(k) ?? { metric, subject, count: 0, ms: 0 };
    c.count += count;
    c.ms += ms;
    counters.set(k, c);
  };
  const storeVisits = new Map<string, number>();
  for (const e of batch.e.slice(0, MAX_EVENTS)) {
    if (e?.t === "page") add("pageviews", "", 1);
    else if (e?.t === "store" && isUuid(e.id)) {
      add("store_views", e.id, 1);
      storeVisits.set(e.id, (storeVisits.get(e.id) ?? 0) + 1);
    } else if (e?.t === "product" && isUuid(e.id)) add("product_views", e.id, 1);
    else if (e?.t === "ad" && isUuid(e.id)) {
      const ms = Math.max(0, Math.min(MAX_AD_MS, Math.round(Number(e.ms) || 0)));
      add("ad_views", e.id, 1, ms);
    }
  }

  if (batch.newDay) {
    const [fresh] = await db.insert(analyticsVisitors).values({ day, visitorId: visitor }).onConflictDoNothing().returning();
    if (fresh) add("visitors", "", 1);
  }
  if (counters.size) {
    await db
      .insert(analyticsDaily)
      .values([...counters.values()].map((c) => ({ day, ...c })))
      .onConflictDoUpdate({
        target: [analyticsDaily.day, analyticsDaily.metric, analyticsDaily.subject],
        set: { count: sql`${analyticsDaily.count} + excluded.count`, ms: sql`${analyticsDaily.ms} + excluded.ms` },
      });
  }
  if (storeVisits.size) {
    const visitorKey = ctx.userId ? `u:${ctx.userId}` : `a:${visitor}`;
    await db
      .insert(visitorStoreMonthly)
      .values([...storeVisits].map(([storeId, visits]) => ({ month: monthOf(day), visitorKey, userId: ctx.userId, storeId, visits, lastSeenAt: new Date() })))
      .onConflictDoUpdate({
        target: [visitorStoreMonthly.month, visitorStoreMonthly.visitorKey, visitorStoreMonthly.storeId],
        set: { visits: sql`${visitorStoreMonthly.visits} + excluded.visits`, lastSeenAt: sql`excluded.last_seen_at` },
      })
      // A store deleted meanwhile shouldn't fail the whole batch.
      .catch((e) => console.error("visitor_store_monthly", e));
  }
}

/** Banner clicks are counted where they happen (the /ad/:id redirect). */
export async function recordAdClick(campaignId: string) {
  if (!(await analyticsOn())) return;
  await db
    .insert(analyticsDaily)
    .values({ day: today(), metric: "ad_clicks", subject: campaignId, count: 1 })
    .onConflictDoUpdate({ target: [analyticsDaily.day, analyticsDaily.metric, analyticsDaily.subject], set: { count: sql`${analyticsDaily.count} + 1` } });
}

// ---------------------------------------------------------------- daily job: roll up and clean up

/** Rolls old daily counters into monthly ones and deletes detail past the admin's retention periods. */
export async function rollupAnalytics() {
  const cfg = await getAnalyticsSettings();
  const cutoff = addDays(today(), -cfg.dailyDays);
  const rolled = await db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into ${analyticsMonthly} (month, metric, subject, count, ms)
      select date_trunc('month', day)::date, metric, subject, sum(count), sum(ms)
      from ${analyticsDaily} where day < ${cutoff}
      group by 1, 2, 3
      on conflict (month, metric, subject) do update
        set count = ${analyticsMonthly.count} + excluded.count, ms = ${analyticsMonthly.ms} + excluded.ms`);
    return tx.delete(analyticsDaily).where(lt(analyticsDaily.day, cutoff)).returning({ day: analyticsDaily.day });
  });
  await db.delete(analyticsVisitors).where(lt(analyticsVisitors.day, addDays(today(), -2)));
  const visitorCutoff = monthsBack(cfg.visitorMonths);
  const monthlyCutoff = monthsBack(cfg.monthlyMonths);
  const visitorRows = await db.delete(visitorStoreMonthly).where(lt(visitorStoreMonthly.month, visitorCutoff)).returning({ m: visitorStoreMonthly.month });
  const monthlyRows = await db.delete(analyticsMonthly).where(lt(analyticsMonthly.month, monthlyCutoff)).returning({ m: analyticsMonthly.month });
  return { rolledDays: rolled.length, visitorRowsDeleted: visitorRows.length, monthlyRowsDeleted: monthlyRows.length };
}

function monthsBack(n: number) {
  const d = new Date(`${today().slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- reports

/** Day-by-day totals for the last `days` days (site-wide page views and unique visitors). */
export async function dailyTotals(days: number) {
  const from = addDays(today(), -(days - 1));
  const rows = await db
    .select({ day: analyticsDaily.day, metric: analyticsDaily.metric, count: analyticsDaily.count })
    .from(analyticsDaily)
    .where(and(gte(analyticsDaily.day, from), inArray(analyticsDaily.metric, ["pageviews", "visitors"]), eq(analyticsDaily.subject, "")));
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(from, i);
    return {
      day,
      pageviews: rows.find((r) => r.day === day && r.metric === "pageviews")?.count ?? 0,
      visitors: rows.find((r) => r.day === day && r.metric === "visitors")?.count ?? 0,
    };
  });
}

async function topSubjects(metric: string, from: string, limit: number) {
  return db
    .select({ subject: analyticsDaily.subject, count: sql<number>`sum(${analyticsDaily.count})`.mapWith(Number), ms: sql<number>`sum(${analyticsDaily.ms})`.mapWith(Number) })
    .from(analyticsDaily)
    .where(and(eq(analyticsDaily.metric, metric), gte(analyticsDaily.day, from)))
    .groupBy(analyticsDaily.subject)
    .orderBy(desc(sql`sum(${analyticsDaily.count})`))
    .limit(limit);
}

export async function topStores(days: number, limit = 10) {
  const rows = await topSubjects("store_views", addDays(today(), -(days - 1)), limit);
  const ids = rows.map((r) => r.subject).filter(isUuid);
  const names = ids.length ? await db.select({ id: stores.id, name: stores.name, slug: stores.slug }).from(stores).where(inArray(stores.id, ids)) : [];
  return rows.map((r) => ({ ...r, store: names.find((n) => n.id === r.subject) ?? null })).filter((r) => r.store);
}

export async function topProducts(days: number, limit = 10) {
  const rows = await topSubjects("product_views", addDays(today(), -(days - 1)), limit);
  const ids = rows.map((r) => r.subject).filter(isUuid);
  const names = ids.length ? await db.select({ id: products.id, title: products.title }).from(products).where(inArray(products.id, ids)) : [];
  return rows.map((r) => ({ ...r, product: names.find((n) => n.id === r.subject) ?? null })).filter((r) => r.product);
}

/** Views, time on screen and clicks for banner ads over a period (all ads, or the given ones). */
export async function adStats(days: number, campaignIds?: string[]) {
  const from = addDays(today(), -(days - 1));
  const rows = await db
    .select({ subject: analyticsDaily.subject, metric: analyticsDaily.metric, count: sql<number>`sum(${analyticsDaily.count})`.mapWith(Number), ms: sql<number>`sum(${analyticsDaily.ms})`.mapWith(Number) })
    .from(analyticsDaily)
    .where(and(inArray(analyticsDaily.metric, ["ad_views", "ad_clicks"]), gte(analyticsDaily.day, from), campaignIds ? inArray(analyticsDaily.subject, campaignIds.length ? campaignIds : ["-"]) : undefined))
    .groupBy(analyticsDaily.subject, analyticsDaily.metric);
  const ids = [...new Set(rows.map((r) => r.subject))].filter(isUuid);
  const campaigns = ids.length
    ? await db.query.adCampaigns.findMany({ where: inArray(adCampaigns.id, ids), columns: { id: true, title: true, number: true, advertiserName: true, placementKey: true } })
    : [];
  return campaigns
    .map((c) => {
      const views = rows.find((r) => r.subject === c.id && r.metric === "ad_views");
      const clicks = rows.find((r) => r.subject === c.id && r.metric === "ad_clicks")?.count ?? 0;
      const v = views?.count ?? 0;
      return { ...c, views: v, clicks, avgSeconds: v ? Math.round((views!.ms / v / 1000) * 10) / 10 : 0, ctr: v ? Math.round((clicks / v) * 1000) / 10 : 0 };
    })
    .sort((a, b) => b.views - a.views);
}

/** Registered customers who visit stores most this month, and the stores they frequent. */
export async function frequentVisitors(limit = 15) {
  const month = monthOf(today());
  const rows = await db
    .select({ userId: visitorStoreMonthly.userId, storeId: visitorStoreMonthly.storeId, visits: visitorStoreMonthly.visits, lastSeenAt: visitorStoreMonthly.lastSeenAt })
    .from(visitorStoreMonthly)
    .where(and(eq(visitorStoreMonthly.month, month), isNotNull(visitorStoreMonthly.userId)))
    .orderBy(desc(visitorStoreMonthly.visits))
    .limit(500);
  const byUser = new Map<string, { total: number; stores: { storeId: string; visits: number }[]; lastSeenAt: Date }>();
  for (const r of rows) {
    const u = byUser.get(r.userId!) ?? { total: 0, stores: [], lastSeenAt: r.lastSeenAt };
    u.total += r.visits;
    u.stores.push({ storeId: r.storeId, visits: r.visits });
    if (r.lastSeenAt > u.lastSeenAt) u.lastSeenAt = r.lastSeenAt;
    byUser.set(r.userId!, u);
  }
  const top = [...byUser].sort((a, b) => b[1].total - a[1].total).slice(0, limit);
  const userIds = top.map(([id]) => id);
  const storeIds = [...new Set(top.flatMap(([, u]) => u.stores.map((s) => s.storeId)))];
  const [people, shops] = await Promise.all([
    userIds.length ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds)) : [],
    storeIds.length ? db.select({ id: stores.id, name: stores.name, slug: stores.slug }).from(stores).where(inArray(stores.id, storeIds)) : [],
  ]);
  return top.map(([id, u]) => ({
    user: people.find((p) => p.id === id) ?? null,
    total: u.total,
    lastSeenAt: u.lastSeenAt,
    stores: u.stores.slice(0, 5).map((s) => ({ ...s, store: shops.find((x) => x.id === s.storeId) ?? null })),
  }));
}

/** Month-by-month site totals: archived monthly summaries plus the current daily detail. */
export async function monthlyTotals(months = 12) {
  const [archived, recent] = await Promise.all([
    db
      .select({ month: analyticsMonthly.month, metric: analyticsMonthly.metric, count: sql<number>`sum(${analyticsMonthly.count})`.mapWith(Number) })
      .from(analyticsMonthly)
      .where(inArray(analyticsMonthly.metric, ["pageviews", "visitors", "ad_views", "ad_clicks", "store_views"]))
      .groupBy(analyticsMonthly.month, analyticsMonthly.metric),
    db
      .select({ month: sql<string>`to_char(date_trunc('month', ${analyticsDaily.day}), 'YYYY-MM-DD')`, metric: analyticsDaily.metric, count: sql<number>`sum(${analyticsDaily.count})`.mapWith(Number) })
      .from(analyticsDaily)
      .where(inArray(analyticsDaily.metric, ["pageviews", "visitors", "ad_views", "ad_clicks", "store_views"]))
      .groupBy(sql`1`, analyticsDaily.metric),
  ]);
  const map = new Map<string, Record<string, number>>();
  for (const r of [...archived, ...recent]) {
    const m = map.get(r.month) ?? {};
    m[r.metric] = (m[r.metric] ?? 0) + r.count;
    map.set(r.month, m);
  }
  return [...map]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, months)
    .map(([month, m]) => ({ month, pageviews: m.pageviews ?? 0, visitors: m.visitors ?? 0, storeViews: m.store_views ?? 0, adViews: m.ad_views ?? 0, adClicks: m.ad_clicks ?? 0 }));
}

/** A store's own page views over the last `days` days (for the merchant's dashboard). */
export async function storeViews(storeId: string, days = 30) {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${analyticsDaily.count}), 0)`.mapWith(Number) })
    .from(analyticsDaily)
    .where(and(eq(analyticsDaily.metric, "store_views"), eq(analyticsDaily.subject, storeId), gte(analyticsDaily.day, addDays(today(), -(days - 1)))));
  return row.n;
}
