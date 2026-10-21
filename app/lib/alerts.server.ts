import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, count, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { AlertType } from "~/db/schema";
import { ALERT_MESSAGE_MAX, ALERT_NAME, ALERT_TYPE_LABEL, MAX_ALERT_ITEMS } from "./alerts";
import { appUrl, escapeHtml, sendEmails, type Email } from "./email.server";
import { money } from "./format";
import { getSettings, intSetting, setSettings } from "./settings.server";
import { isUuid } from "./utils";

const { stockAlerts, stockAlertItems, alertDeliveries, storeSubscriptions, users, products, stores } = schema;

export class AlertError extends Error {}

// ---------------------------------------------------------------- admin limits

export type AlertSettings = { enabled: boolean; weeklyLimit: number; cooldownDays: number; minDiscountPct: number };
const DEFAULTS: AlertSettings = { enabled: true, weeklyLimit: 3, cooldownDays: 7, minDiscountPct: 10 };
const KEYS = {
  enabled: "alerts_enabled",
  weeklyLimit: "alerts_weekly_limit",
  cooldownDays: "alerts_cooldown_days",
  minDiscountPct: "alerts_min_discount_pct",
} as const;

export async function getAlertSettings(): Promise<AlertSettings> {
  const all = await getSettings();
  return {
    enabled: (all[KEYS.enabled] ?? "true") === "true",
    weeklyLimit: intSetting(all, KEYS.weeklyLimit, DEFAULTS.weeklyLimit),
    cooldownDays: intSetting(all, KEYS.cooldownDays, DEFAULTS.cooldownDays),
    minDiscountPct: intSetting(all, KEYS.minDiscountPct, DEFAULTS.minDiscountPct),
  };
}

export function saveAlertSettings(v: AlertSettings) {
  return setSettings(
    Object.fromEntries(Object.entries(KEYS).map(([field, key]) => [key, String(v[field as keyof AlertSettings])])),
  );
}

const weekAgo = () => new Date(Date.now() - 7 * 86_400_000);

/** How many alerts the store has sent in the last 7 days against the admin's limit. */
export async function getQuota(storeId: string, s?: AlertSettings) {
  const cfg = s ?? (await getAlertSettings());
  const [[{ used }], store] = await Promise.all([
    db.select({ used: count() }).from(stockAlerts).where(and(eq(stockAlerts.storeId, storeId), gt(stockAlerts.createdAt, weekAgo()))),
    db.query.stores.findFirst({ where: eq(stores.id, storeId), columns: { alertsBlocked: true } }),
  ]);
  return {
    enabled: cfg.enabled,
    blocked: !!store?.alertsBlocked,
    used,
    limit: cfg.weeklyLimit,
    remaining: Math.max(0, cfg.weeklyLimit - used),
  };
}

// ---------------------------------------------------------------- subscriptions

const TYPE_FIELD = {
  new_product: storeSubscriptions.newProducts,
  restock: storeSubscriptions.restocks,
  discount: storeSubscriptions.discounts,
} as const;

/** Customers who'd get this type of alert from this store: subscribed to it and not opted out. */
function recipientsWhere(storeId: string, type: AlertType) {
  return and(
    eq(storeSubscriptions.storeId, storeId),
    eq(TYPE_FIELD[type], true),
    eq(users.emailAlerts, true),
    eq(users.status, "active"),
    eq(users.role, "customer"),
  );
}

/** Numbers only: merchants never see who their subscribers are. */
export async function subscriberCounts(storeId: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      new_product: sql<number>`count(*) filter (where ${storeSubscriptions.newProducts})::int`,
      restock: sql<number>`count(*) filter (where ${storeSubscriptions.restocks})::int`,
      discount: sql<number>`count(*) filter (where ${storeSubscriptions.discounts})::int`,
    })
    .from(storeSubscriptions)
    .innerJoin(users, eq(users.id, storeSubscriptions.userId))
    .where(and(eq(storeSubscriptions.storeId, storeId), eq(users.emailAlerts, true), eq(users.status, "active")));
  return row;
}

export async function getSubscription(userId: string, storeId: string) {
  return db.query.storeSubscriptions.findFirst({
    where: and(eq(storeSubscriptions.userId, userId), eq(storeSubscriptions.storeId, storeId)),
  });
}

/** Saves which alert types a customer wants from a store. Choosing none unsubscribes. */
/** What the follow button needs; null for guests, merchants and admins. */
export async function getFollowState(user: { id: string; role: string } | null, storeId: string) {
  if (!user || user.role !== "customer") return null;
  const [subscription, row] = await Promise.all([
    getSubscription(user.id, storeId),
    db.query.users.findFirst({ where: eq(users.id, user.id), columns: { emailAlerts: true } }),
  ]);
  return {
    subscription: subscription
      ? { newProducts: subscription.newProducts, restocks: subscription.restocks, discounts: subscription.discounts }
      : null,
    emailAlerts: row?.emailAlerts ?? true,
  };
}

export async function setSubscription(
  userId: string,
  storeId: string,
  prefs: { newProducts: boolean; restocks: boolean; discounts: boolean },
) {
  if (!prefs.newProducts && !prefs.restocks && !prefs.discounts) return unsubscribeStore(userId, storeId);
  await db
    .insert(storeSubscriptions)
    .values({ userId, storeId, ...prefs })
    .onConflictDoUpdate({
      target: [storeSubscriptions.userId, storeSubscriptions.storeId],
      set: { ...prefs, updatedAt: new Date() },
    });
}

export async function unsubscribeStore(userId: string, storeId: string) {
  await db
    .delete(storeSubscriptions)
    .where(and(eq(storeSubscriptions.userId, userId), eq(storeSubscriptions.storeId, storeId)));
}

export async function setEmailAlerts(userId: string, enabled: boolean) {
  await db.update(users).set({ emailAlerts: enabled, updatedAt: new Date() }).where(eq(users.id, userId));
}

// ---------------------------------------------------------------- unsubscribe links

function sign(userId: string) {
  const secret = process.env.SESSION_SECRET!;
  return createHmac("sha256", secret).update(`unsubscribe:${userId}`).digest("base64url");
}

/** Signed link that works without signing in. With a store, it unsubscribes from that store only. */
export function unsubscribeUrl(userId: string, storeId?: string) {
  const params = new URLSearchParams({ u: userId, t: sign(userId) });
  if (storeId) params.set("s", storeId);
  return `${appUrl()}/alerts/unsubscribe?${params}`;
}

export function verifyUnsubscribe(userId: string | null, token: string | null) {
  if (!userId || !token) return false;
  const a = Buffer.from(sign(userId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- sending

/** Plain text only, no links: an alert can't be used to send customers to a look-alike site. */
export function cleanMessage(message: string) {
  return message
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link removed]")
    .trim()
    .slice(0, ALERT_MESSAGE_MAX);
}

function discountPct(p: { priceCents: number; compareAtCents: number | null }) {
  return p.compareAtCents && p.compareAtCents > p.priceCents ? Math.round((1 - p.priceCents / p.compareAtCents) * 100) : 0;
}

/**
 * Why this alert can't be sent right now, or null if it can. Checks the admin's limits
 * as well as whether the alert is true for every product in it (e.g. a real discount).
 */
export async function checkAlert(storeId: string, productIds: string[], type: AlertType): Promise<string | null> {
  const ids = [...new Set(productIds)];
  if (!ids.length || !ids.every(isUuid)) return "Choose at least one of your products.";
  if (ids.length > MAX_ALERT_ITEMS) return `An alert can include up to ${MAX_ALERT_ITEMS} products.`;
  const cfg = await getAlertSettings();
  if (!cfg.enabled) return "Email alerts are switched off by MyPlug at the moment.";
  const quota = await getQuota(storeId, cfg);
  if (quota.blocked) return "MyPlug has paused email alerts for your store. Contact support.";
  if (quota.remaining <= 0) return `You've used all ${quota.limit} alerts for this week. Try again in a few days.`;

  const found = await db.query.products.findMany({
    where: and(inArray(products.id, ids), eq(products.storeId, storeId)),
    with: { store: { columns: { status: true } } },
  });
  if (found.length !== ids.length) return "Choose products from your own store.";
  for (const p of found) {
    if (!p.isActive || p.store.status !== "approved") return `"${p.title}" isn't visible to shoppers.`;
    if (type === "restock" && p.kind === "product" && p.trackStock && p.quantity <= 0) {
      return `Restock alerts need every product in stock: "${p.title}" is sold out.`;
    }
    if (type === "discount" && discountPct(p) < cfg.minDiscountPct) {
      return `Discount alerts need at least ${cfg.minDiscountPct}% off each product. Set a higher "Was" price on "${p.title}".`;
    }
  }

  const since = type === "new_product" ? new Date(0) : new Date(Date.now() - cfg.cooldownDays * 86_400_000);
  const [recent] = await db
    .select({ title: products.title })
    .from(stockAlertItems)
    .innerJoin(stockAlerts, eq(stockAlerts.id, stockAlertItems.alertId))
    .innerJoin(products, eq(products.id, stockAlertItems.productId))
    .where(and(inArray(stockAlertItems.productId, ids), eq(stockAlerts.type, type), gt(stockAlerts.createdAt, since)))
    .limit(1);
  if (recent) {
    return type === "new_product"
      ? `A new-arrival alert was already sent for "${recent.title}".`
      : `A ${ALERT_NAME[type]} alert was already sent for "${recent.title}" in the last ${cfg.cooldownDays} days.`;
  }

  const counts = await subscriberCounts(storeId);
  if (!counts[type]) return `None of your subscribers want ${ALERT_NAME[type]} alerts yet.`;
  return null;
}

/** Creates the alert and one queued email per subscriber, then starts sending. */
export async function sendAlert(input: { storeId: string; productIds: string[]; type: AlertType; message: string; userId: string }) {
  const productIds = [...new Set(input.productIds)];
  const reason = await checkAlert(input.storeId, productIds, input.type);
  if (reason) throw new AlertError(reason);
  const cfg = await getAlertSettings();

  const alert = await db.transaction(async (tx) => {
    // Lock the store row so two alerts sent at the same moment can't both slip under the weekly limit.
    await tx.select({ id: stores.id }).from(stores).where(eq(stores.id, input.storeId)).for("update");
    const [{ used }] = await tx
      .select({ used: count() })
      .from(stockAlerts)
      .where(and(eq(stockAlerts.storeId, input.storeId), gt(stockAlerts.createdAt, weekAgo())));
    if (used >= cfg.weeklyLimit) throw new AlertError(`You've used all ${cfg.weeklyLimit} alerts for this week.`);

    const [alert] = await tx
      .insert(stockAlerts)
      .values({
        storeId: input.storeId,
        type: input.type,
        message: cleanMessage(input.message) || null,
        createdById: input.userId,
      })
      .returning();
    await tx.insert(stockAlertItems).values(productIds.map((productId, position) => ({ alertId: alert.id, productId, position })));
    const recipients = await tx
      .select({ userId: storeSubscriptions.userId })
      .from(storeSubscriptions)
      .innerJoin(users, eq(users.id, storeSubscriptions.userId))
      .where(recipientsWhere(input.storeId, input.type));
    if (recipients.length) {
      await tx.insert(alertDeliveries).values(recipients.map((r) => ({ alertId: alert.id, userId: r.userId })));
    }
    const [updated] = await tx
      .update(stockAlerts)
      .set({ recipientCount: recipients.length })
      .where(eq(stockAlerts.id, alert.id))
      .returning();
    return updated;
  });

  // Send the first batch now; anything left is picked up by the scheduled job (/api/cron/alerts).
  try {
    await processAlertQueue(100);
  } catch (e) {
    console.error("Alert sending failed; it will be retried", e);
  }
  return alert;
}

type DeliveryRow = Awaited<ReturnType<typeof loadDeliveries>>[number];
type AlertItem = Awaited<ReturnType<typeof loadItems>> extends Map<string, (infer T)[]> ? T : never;

function loadDeliveries(ids: string[]) {
  return db
    .select({
      id: alertDeliveries.id,
      alertId: alertDeliveries.alertId,
      attempts: alertDeliveries.attempts,
      userId: users.id,
      email: users.email,
      emailAlerts: users.emailAlerts,
      userStatus: users.status,
      subNew: storeSubscriptions.newProducts,
      subRestock: storeSubscriptions.restocks,
      subDiscount: storeSubscriptions.discounts,
      type: stockAlerts.type,
      message: stockAlerts.message,
      storeId: stores.id,
      storeName: stores.name,
      storeSlug: stores.slug,
      currency: stores.currency,
      alertsBlocked: stores.alertsBlocked,
    })
    .from(alertDeliveries)
    .innerJoin(stockAlerts, eq(stockAlerts.id, alertDeliveries.alertId))
    .innerJoin(users, eq(users.id, alertDeliveries.userId))
    .innerJoin(stores, eq(stores.id, stockAlerts.storeId))
    .leftJoin(
      storeSubscriptions,
      and(eq(storeSubscriptions.userId, alertDeliveries.userId), eq(storeSubscriptions.storeId, stockAlerts.storeId)),
    )
    .where(inArray(alertDeliveries.id, ids));
}

/** The still-visible products of each alert, in the order the merchant chose. */
async function loadItems(alertIds: string[]) {
  const rows = await db
    .select({
      alertId: stockAlertItems.alertId,
      productId: products.id,
      title: products.title,
      priceCents: products.priceCents,
      compareAtCents: products.compareAtCents,
      imageUrl: products.imageUrl,
      imageHidden: products.imageHidden,
      kind: products.kind,
    })
    .from(stockAlertItems)
    .innerJoin(products, eq(products.id, stockAlertItems.productId))
    .where(and(inArray(stockAlertItems.alertId, alertIds), eq(products.isActive, true)))
    .orderBy(asc(stockAlertItems.position));
  const byAlert = new Map<string, Omit<(typeof rows)[number], "alertId">[]>();
  for (const { alertId, ...item } of rows) byAlert.set(alertId, [...(byAlert.get(alertId) ?? []), item]);
  return byAlert;
}

/** Opt-outs are checked again at send time, so unsubscribing stops even queued emails. */
function stillWanted(d: DeliveryRow, items: AlertItem[]) {
  const wantsType = { new_product: d.subNew, restock: d.subRestock, discount: d.subDiscount }[d.type];
  return d.emailAlerts && d.userStatus === "active" && wantsType === true && items.length > 0 && !d.alertsBlocked;
}

type EmailInput = Pick<DeliveryRow, "userId" | "email" | "type" | "message" | "storeId" | "storeName" | "storeSlug" | "currency">;

/** The email for one recipient. Same fixed template for every store, sent from MyPlug's address. */
export function buildAlertEmail(d: EmailInput, items: AlertItem[]): Email {
  const base = appUrl();
  const store = d.storeName;
  const storeUrl = `${base}/s/${d.storeSlug}`;
  const first = items[0];
  const more = items.length > 1 ? ` and ${items.length - 1} more` : "";
  const bestPct = Math.max(...items.map(discountPct));
  const subject = {
    new_product: `New at ${store}: ${first.title}${more}`,
    restock: `Back in stock at ${store}: ${first.title}${more}`,
    discount: `${items.length > 1 ? "Up to " : ""}${bestPct}% off at ${store}: ${first.title}${more}`,
  }[d.type];
  const headline = { new_product: "Just listed", restock: "Back in stock", discount: "On sale" }[d.type];
  const storeUnsub = unsubscribeUrl(d.userId, d.storeId);
  const allUnsub = unsubscribeUrl(d.userId);
  const manage = `${base}/account/alerts`;
  const e = escapeHtml;

  const cards = items
    .map((p) => {
      const url = `${base}/p/${p.productId}`;
      const image = p.imageUrl && !p.imageHidden ? (p.imageUrl.startsWith("/") ? base + p.imageUrl : p.imageUrl) : null;
      const pct = discountPct(p);
      const price = `${p.kind === "service" ? "from " : ""}${money(p.priceCents, d.currency)}`;
      const was = pct ? money(p.compareAtCents!, d.currency) : null;
      // Two per row on wide screens; table cells stack acceptably in narrow mail apps.
      return `<td width="50%" valign="top" style="padding:6px">
<a href="${e(url)}" style="text-decoration:none;color:#1f1a24">
${image ? `<img src="${e(image)}" alt="" width="224" style="width:100%;max-width:224px;border-radius:10px;display:block">` : ""}
<p style="margin:8px 0 2px;font-size:14px;font-weight:bold">${e(p.title)}</p>
<p style="margin:0;font-size:15px;font-weight:bold;color:#ff5a4e">${e(price)}${was ? ` <span style="font-size:12px;color:#888;text-decoration:line-through;font-weight:normal">${e(was)}</span>` : ""}${pct ? ` <span style="font-size:12px;color:#0f9d8a">-${pct}%</span>` : ""}</p>
</a></td>`;
    });
  const rows: string[] = [];
  for (let i = 0; i < cards.length; i += 2) rows.push(`<tr>${cards[i]}${cards[i + 1] ?? '<td width="50%"></td>'}</tr>`);

  const html = `<!doctype html><html><body style="margin:0;background:#fff7f2;font-family:Arial,Helvetica,sans-serif;color:#1f1a24">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:linear-gradient(90deg,#ff5a4e,#ff8a3d);background-color:#ff5a4e;padding:16px 24px;color:#fff;font-size:20px;font-weight:bold">MyPlug</td></tr>
<tr><td style="padding:24px 18px 8px">
<p style="margin:0 6px 4px;font-size:13px;font-weight:bold;letter-spacing:.05em;text-transform:uppercase;color:#0f9d8a">${e(headline)} · ${e(store)}</p>
<h1 style="margin:0 6px 12px;font-size:22px">${e(items.length > 1 ? `${items.length} picks from ${store}` : first.title)}</h1>
${d.message ? `<p style="margin:0 6px 12px;padding:12px 16px;background:#f4f1f6;border-radius:10px;font-size:14px"><strong>Message from ${e(store)}:</strong><br>${e(d.message).replace(/\n/g, "<br>")}</p>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table>
</td></tr>
<tr><td style="padding:8px 24px 24px">
<a href="${e(storeUrl)}" style="display:inline-block;background:#ff5a4e;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">See everything at ${e(store)}</a>
<p style="margin:12px 0 0;font-size:13px"><a href="${e(base)}" style="color:#0f9d8a">Browse more on MyPlug</a></p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #eee;font-size:12px;color:#777;line-height:1.5">
You're getting this because you follow ${e(store)} on MyPlug and chose ${e(ALERT_TYPE_LABEL[d.type].toLowerCase())} alerts.
MyPlug sends these emails for stores; stores never see your email address. We'll never ask for your password or payment details by email.<br>
<a href="${e(storeUnsub)}" style="color:#777">Unsubscribe from ${e(store)}</a> · <a href="${e(allUnsub)}" style="color:#777">Stop all alerts</a> · <a href="${e(manage)}" style="color:#777">Choose which alerts you get</a>
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    `${headline} at ${store}`,
    d.message ? `\nMessage from ${store}:\n${d.message}\n` : "",
    ...items.map((p) => {
      const pct = discountPct(p);
      return `- ${p.title}: ${money(p.priceCents, d.currency)}${pct ? ` (was ${money(p.compareAtCents!, d.currency)})` : ""}\n  ${base}/p/${p.productId}`;
    }),
    "",
    `See everything at ${store}: ${storeUrl}`,
    `Browse more on MyPlug: ${base}`,
    "",
    `You follow ${store} on MyPlug. Stores never see your email address.`,
    `Unsubscribe from ${store}: ${storeUnsub}`,
    `Stop all alerts: ${allUnsub}`,
    `Choose which alerts you get: ${manage}`,
  ].join("\n");

  return {
    to: d.email,
    subject,
    html,
    text,
    headers: { "List-Unsubscribe": `<${storeUnsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

const MAX_ATTEMPTS = 3;

/**
 * Sends queued alert emails in batches. Rows are claimed first ("sending"), so two
 * senders running at once never email the same person twice. A claim older than
 * 10 minutes (a crashed sender) is picked up again.
 */
export async function processAlertQueue(limit = 100) {
  const claimable = db
    .select({ id: alertDeliveries.id })
    .from(alertDeliveries)
    .where(
      or(
        eq(alertDeliveries.status, "pending"),
        and(eq(alertDeliveries.status, "sending"), lt(alertDeliveries.claimedAt, new Date(Date.now() - 10 * 60_000))),
      ),
    )
    .orderBy(asc(alertDeliveries.createdAt))
    .limit(Math.min(limit, 100))
    .for("update", { skipLocked: true });
  const claimed = await db
    .update(alertDeliveries)
    .set({ status: "sending", claimedAt: new Date(), attempts: sql`${alertDeliveries.attempts} + 1` })
    .where(inArray(alertDeliveries.id, claimable))
    .returning({ id: alertDeliveries.id });
  if (!claimed.length) return { sent: 0, skipped: 0, failed: 0 };

  const rows = await loadDeliveries(claimed.map((c) => c.id));
  const items = await loadItems([...new Set(rows.map((r) => r.alertId))]);
  const itemsFor = (r: DeliveryRow) => items.get(r.alertId) ?? [];
  const skip = rows.filter((r) => !stillWanted(r, itemsFor(r)));
  const send = rows.filter((r) => stillWanted(r, itemsFor(r)));

  if (skip.length) {
    await db.update(alertDeliveries).set({ status: "skipped" }).where(inArray(alertDeliveries.id, skip.map((r) => r.id)));
  }

  const results = await sendEmails(send.map((r) => buildAlertEmail(r, itemsFor(r))));
  const ok = send.filter((_, i) => results[i].ok);
  const bad = send.filter((_, i) => !results[i].ok);
  if (ok.length) {
    await db.update(alertDeliveries).set({ status: "sent", sentAt: new Date(), error: null }).where(inArray(alertDeliveries.id, ok.map((r) => r.id)));
  }
  for (const r of bad) {
    const result = results[send.indexOf(r)];
    await db
      .update(alertDeliveries)
      .set({ status: r.attempts >= MAX_ATTEMPTS ? "failed" : "pending", error: result.ok ? null : result.error })
      .where(eq(alertDeliveries.id, r.id));
  }
  return { sent: ok.length, skipped: skip.length, failed: bad.length };
}

/** Admin preview of what an alert's email looks like, addressed to a sample customer. */
export async function previewAlertEmail(alertId: string) {
  const alert = await db.query.stockAlerts.findFirst({ where: eq(stockAlerts.id, alertId), with: { store: true } });
  if (!alert) return null;
  const items = (await loadItems([alert.id])).get(alert.id) ?? [];
  if (!items.length) return null;
  return buildAlertEmail(
    {
      userId: "00000000-0000-0000-0000-000000000000",
      email: "customer@example.com",
      type: alert.type,
      message: alert.message,
      storeId: alert.store.id,
      storeName: alert.store.name,
      storeSlug: alert.store.slug,
      currency: alert.store.currency,
    },
    items,
  );
}
