import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { appUrl, escapeHtml, sendEmails, type Email } from "./email.server";
import { getSettings, intSetting, setSettings } from "./settings.server";

const { users, stores, products, orders, storeSubscriptions, recurringPlans } = schema;

export type RetentionSettings = { enabled: boolean; archiveMonths: number; deleteMonths: number; warningDays: number };

export async function getRetentionSettings(): Promise<RetentionSettings> {
  const all = await getSettings();
  const archiveMonths = intSetting(all, "retention_archive_months", 6, 1);
  return {
    enabled: (all.retention_enabled ?? "true") === "true",
    archiveMonths,
    deleteMonths: Math.max(archiveMonths + 1, intSetting(all, "retention_delete_months", 12, 2)),
    warningDays: intSetting(all, "retention_warning_days", 30, 1),
  };
}

export function saveRetentionSettings(v: RetentionSettings) {
  return setSettings({
    retention_enabled: String(v.enabled),
    retention_archive_months: String(v.archiveMonths),
    retention_delete_months: String(v.deleteMonths),
    retention_warning_days: String(v.warningDays),
  });
}

const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
};

/**
 * When a store was last active: its owner signing in or using the site, or a customer
 * ordering from it (a store that keeps selling isn't inactive).
 */
const lastActivity = sql<Date>`greatest(
  ${users.lastActiveAt},
  coalesce((select max(o.created_at) from ${orders} o where o.store_id = ${stores.id}), 'epoch'::timestamptz)
)`;

function storesWhere(where: SQL | undefined) {
  return db
    .select({ storeId: stores.id, ownerId: users.id, name: stores.name, email: users.email, ownerName: users.name })
    .from(stores)
    .innerJoin(users, eq(users.id, stores.ownerId))
    .where(where)
    .limit(200);
}

/** Stores that each step would affect right now (for the admin preview and the job). */
export async function retentionCandidates(cfg: RetentionSettings) {
  const deleteCutoff = monthsAgo(cfg.deleteMonths);
  const [toArchive, toWarn, toDelete] = await Promise.all([
    storesWhere(and(eq(stores.status, "approved"), lt(lastActivity, monthsAgo(cfg.archiveMonths)))),
    // Warn `warningDays` before the deletion date.
    storesWhere(
      and(
        eq(stores.status, "archived"),
        isNull(stores.deletionWarnedAt),
        lt(lastActivity, new Date(deleteCutoff.getTime() + cfg.warningDays * 86_400_000)),
      ),
    ),
    storesWhere(
      and(
        eq(stores.status, "archived"),
        isNotNull(stores.deletionWarnedAt),
        // Always give the full warning period, even if the admin shortened the settings since.
        lt(stores.deletionWarnedAt, new Date(Date.now() - cfg.warningDays * 86_400_000)),
        lt(lastActivity, deleteCutoff),
      ),
    ),
  ]);
  return { toArchive, toWarn, toDelete };
}

function notice(to: string, subject: string, lines: string[]): Email {
  const signIn = `${appUrl()}/login`;
  const text = [...lines, "", `Sign in: ${signIn}`].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px">${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}<p><a href="${escapeHtml(signIn)}">Sign in to MyPlug</a></p></div>`;
  return { to, subject, html, text };
}

/**
 * Daily housekeeping: archive inactive stores, warn owners before deletion, then delete
 * the accounts. Deleting keeps orders and bills (customers' and tax records) but removes
 * the merchant's personal details, login and listings.
 */
export async function runRetention() {
  const cfg = await getRetentionSettings();
  if (!cfg.enabled) return { archived: 0, warned: 0, deleted: 0 };
  const { toArchive, toWarn, toDelete } = await retentionCandidates(cfg);
  const now = new Date();

  if (toArchive.length) {
    await db
      .update(stores)
      .set({ status: "archived", archivedAt: now })
      .where(inArray(stores.id, toArchive.map((s) => s.storeId)));
    await sendEmails(
      toArchive.map((s) =>
        notice(s.email, `Your store ${s.name} has been archived`, [
          `Hi ${s.ownerName},`,
          `${s.name} hasn't been active on MyPlug for ${cfg.archiveMonths} months, so we've archived it: your listings are hidden from shoppers.`,
          `Sign in any time to restore it. If it stays inactive for ${cfg.deleteMonths} months in total, the account will be deleted.`,
        ]),
      ),
    );
  }

  if (toWarn.length) {
    await db
      .update(stores)
      .set({ deletionWarnedAt: now })
      .where(inArray(stores.id, toWarn.map((s) => s.storeId)));
    await sendEmails(
      toWarn.map((s) =>
        notice(s.email, `${s.name} will be deleted in ${cfg.warningDays} days`, [
          `Hi ${s.ownerName},`,
          `${s.name} has been inactive for a long time and will be deleted in ${cfg.warningDays} days, along with your login and listings.`,
          "Sign in before then to keep your store.",
        ]),
      ),
    );
  }

  for (const s of toDelete) await deleteMerchantAccount(s.ownerId, s.storeId);

  return { archived: toArchive.length, warned: toWarn.length, deleted: toDelete.length };
}

/** Removes a merchant's personal data, login and listings; keeps order and bill history anonymised. */
export async function deleteMerchantAccount(userId: string, storeId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(products).where(eq(products.storeId, storeId)); // gallery, ads, alert items cascade
    await tx.delete(storeSubscriptions).where(eq(storeSubscriptions.storeId, storeId));
    await tx
      .update(recurringPlans)
      .set({ status: "cancelled", lastError: "The store closed.", updatedAt: new Date() })
      .where(and(eq(recurringPlans.storeId, storeId), inArray(recurringPlans.status, ["active", "paused"])));
    await tx
      .update(stores)
      .set({
        name: "Closed store",
        slug: `closed-${storeId.slice(0, 8)}`,
        description: null,
        logoUrl: null,
        status: "suspended", // closed for good; also keeps it out of future retention runs
        reviewNote: "Deleted automatically after inactivity",
      })
      .where(eq(stores.id, storeId));
    await tx
      .update(users)
      .set({
        email: `deleted-${userId}@deleted.invalid`,
        name: "Deleted account",
        phone: null,
        passwordHash: randomBytes(32).toString("hex"), // not a valid bcrypt hash: nobody can sign in
        status: "suspended",
        emailAlerts: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  });
}

/** A returning merchant gets their archived store back automatically. */
export async function restoreArchivedStore(ownerId: string) {
  await db
    .update(stores)
    .set({ status: "approved", archivedAt: null, deletionWarnedAt: null })
    .where(and(eq(stores.ownerId, ownerId), eq(stores.status, "archived")));
}
