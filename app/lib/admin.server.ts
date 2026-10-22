import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { SessionUser } from "./auth.server";
import { bannerCounts } from "./banners.server";
import { str } from "./utils";

const { users, stores, promotions, reports } = schema;

/** Numbers shown on the admin nav and overview: things waiting for an admin. */
export async function getAdminCounts() {
  const [[merchants], [ads], [openReports], [pendingCouriers], [pendingLicenses]] = await Promise.all([
    db
      .select({ pending: sql<number>`count(*) filter (where ${stores.status} = 'pending')::int` })
      .from(stores),
    db
      .select({
        toQuote: sql<number>`count(*) filter (where ${promotions.status} = 'pending_quote')::int`,
        toVerify: sql<number>`count(*) filter (where ${promotions.status} = 'payment_submitted')::int`,
      })
      .from(promotions),
    db
      .select({ n: sql<number>`count(distinct (${reports.targetType}, ${reports.targetId}))::int` })
      .from(reports)
      .where(eq(reports.status, "open")),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.couriers).where(eq(schema.couriers.status, "pending")),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.businessLicenses).where(eq(schema.businessLicenses.status, "pending")),
  ]);
  const [[flagged], banners] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.reviews).where(eq(schema.reviews.status, "flagged")),
    bannerCounts(),
  ]);
  return {
    pendingMerchants: merchants.pending,
    adsToQuote: ads.toQuote,
    paymentsToVerify: ads.toVerify,
    openReports: openReports.n,
    pendingCouriers: pendingCouriers.n,
    pendingLicenses: pendingLicenses.n,
    flaggedReviews: flagged.n,
    banners,
  };
}

export type AccountAction = "approve" | "reject" | "suspend" | "reactivate";
const ACTIONS: AccountAction[] = ["approve", "reject", "suspend", "reactivate"];

/**
 * Applies an admin decision to a user (and their store, for merchants).
 * Shared by the merchant list, the customer list and the user detail page.
 */
export async function handleAccountAction(admin: SessionUser, form: FormData) {
  const action = str(form.get("action")) as AccountAction;
  const userId = str(form.get("userId"));
  const note = str(form.get("note")).slice(0, 500) || null;
  if (!ACTIONS.includes(action)) return { error: "Unknown action." };
  if (userId === admin.id) return { error: "You can't change your own account here." };

  const target = await db.query.users.findFirst({ where: eq(users.id, userId), with: { store: true } });
  if (!target) return { error: "Account not found." };
  if (target.role === "admin") return { error: "Admin accounts can't be changed here." };
  const now = new Date();

  switch (action) {
    case "approve":
    case "reject": {
      if (!target.store) return { error: "This account has no store." };
      if (action === "reject" && !note) return { error: "Give the merchant a reason for rejecting." };
      await db
        .update(stores)
        .set({ status: action === "approve" ? "approved" : "rejected", reviewNote: note, reviewedAt: now })
        .where(and(eq(stores.id, target.store.id), inArray(stores.status, ["pending", "rejected"])));
      return { ok: `${target.store.name} ${action === "approve" ? "approved" : "rejected"}.` };
    }
    case "suspend": {
      if (!note) return { error: "Give a reason for suspending this account." };
      await db.transaction(async (tx) => {
        await tx.update(users).set({ status: "suspended", updatedAt: now }).where(eq(users.id, userId));
        if (target.store) {
          await tx
            .update(stores)
            .set({ status: "suspended", reviewNote: note, reviewedAt: now })
            .where(eq(stores.id, target.store.id));
        }
      });
      return { ok: `${target.name} suspended. They've been signed out.` };
    }
    case "reactivate": {
      await db.transaction(async (tx) => {
        await tx.update(users).set({ status: "active", updatedAt: now }).where(eq(users.id, userId));
        if (target.store?.status === "suspended") {
          await tx
            .update(stores)
            .set({ status: "approved", reviewNote: note, reviewedAt: now })
            .where(eq(stores.id, target.store.id));
        }
      });
      return { ok: `${target.name} reactivated.` };
    }
  }
}

/** Escaped ILIKE pattern for a free-text search box. */
export function likeTerm(q: string) {
  return `%${q.replace(/[%_\\]/g, "\\$&")}%`;
}
