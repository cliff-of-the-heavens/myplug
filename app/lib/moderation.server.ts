import { and, countDistinct, eq, inArray } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { ReportTarget } from "~/db/schema";
import type { SessionUser } from "./auth.server";
import { REPORT_REASONS } from "./moderation";

const { reports, products, messages, requests, stores, users } = schema;

const AUTO_HIDE_THRESHOLD = Number(process.env.REPORT_AUTO_HIDE_THRESHOLD ?? 3);

export class ReportError extends Error {}

/** Hides or restores the image attached to a reportable item. */
async function setImageHidden(type: ReportTarget, id: string, hidden: boolean) {
  if (type === "product") await db.update(products).set({ imageHidden: hidden }).where(eq(products.id, id));
  if (type === "message") await db.update(messages).set({ imageHidden: hidden }).where(eq(messages.id, id));
  if (type === "request") await db.update(requests).set({ imageHidden: hidden }).where(eq(requests.id, id));
}

/** Makes sure the target exists and the reporter could actually see it. */
async function assertCanSee(user: SessionUser, type: ReportTarget, id: string) {
  let ok = false;
  if (type === "product") ok = !!(await db.query.products.findFirst({ where: eq(products.id, id), columns: { id: true } }));
  if (type === "request") ok = !!(await db.query.requests.findFirst({ where: eq(requests.id, id), columns: { id: true } }));
  if (type === "store") ok = !!(await db.query.stores.findFirst({ where: eq(stores.id, id), columns: { id: true } }));
  if (type === "message") {
    const msg = await db.query.messages.findFirst({
      where: eq(messages.id, id),
      with: { conversation: { columns: { customerId: true, storeId: true } } },
    });
    ok = !!msg && (msg.conversation.customerId === user.id || msg.conversation.storeId === user.storeId);
  }
  if (!ok) throw new ReportError("That item could not be found.");
}

export async function fileReport(
  user: SessionUser,
  input: { targetType: ReportTarget; targetId: string; reason: string; details?: string },
) {
  if (!REPORT_REASONS.some((r) => r.value === input.reason)) throw new ReportError("Choose a reason.");
  await assertCanSee(user, input.targetType, input.targetId);

  await db
    .insert(reports)
    .values({
      reporterId: user.id,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      details: input.details?.slice(0, 1000) || null,
    })
    .onConflictDoNothing(); // already reported by this user

  // Several independent reports => hide the image now, pending admin review.
  const [{ n }] = await db
    .select({ n: countDistinct(reports.reporterId) })
    .from(reports)
    .where(
      and(
        eq(reports.targetType, input.targetType),
        eq(reports.targetId, input.targetId),
        eq(reports.status, "open"),
      ),
    );
  // Nudity is hidden on the first report: the cost of a false positive is low.
  if (n >= AUTO_HIDE_THRESHOLD || input.reason === "nudity") {
    await setImageHidden(input.targetType, input.targetId, true);
  }
}

export type ModerationAction = "remove" | "restore" | "dismiss" | "suspend";

/** Admin decision applied to every open report about the same target. */
export async function resolveReports(
  admin: SessionUser,
  input: { targetType: ReportTarget; targetId: string; action: ModerationAction; note?: string },
) {
  const { targetType, targetId, action } = input;

  if (action === "remove") {
    await setImageHidden(targetType, targetId, true);
    if (targetType === "product") {
      await db.update(products).set({ isActive: false }).where(eq(products.id, targetId));
    }
    if (targetType === "request") {
      await db.update(requests).set({ status: "closed" }).where(eq(requests.id, targetId));
    }
  } else if (action === "restore" || action === "dismiss") {
    await setImageHidden(targetType, targetId, false);
  } else if (action === "suspend") {
    const ownerId = await ownerOf(targetType, targetId);
    await setImageHidden(targetType, targetId, true);
    if (ownerId) {
      await db.update(users).set({ status: "suspended" }).where(eq(users.id, ownerId));
      // A suspended merchant's store goes offline too.
      await db
        .update(stores)
        .set({ status: "suspended", reviewNote: input.note || "Suspended after reports", reviewedAt: new Date() })
        .where(eq(stores.ownerId, ownerId));
    }
  }

  await db
    .update(reports)
    .set({
      status: action === "dismiss" || action === "restore" ? "dismissed" : "actioned",
      reviewedById: admin.id,
      reviewedAt: new Date(),
      resolutionNote: input.note || action,
    })
    .where(
      and(eq(reports.targetType, targetType), eq(reports.targetId, targetId), inArray(reports.status, ["open"])),
    );
}

/** The user responsible for a piece of content. */
export async function ownerOf(type: ReportTarget, id: string): Promise<string | null> {
  if (type === "message") {
    return (await db.query.messages.findFirst({ where: eq(messages.id, id), columns: { senderId: true } }))?.senderId ?? null;
  }
  if (type === "request") {
    return (await db.query.requests.findFirst({ where: eq(requests.id, id), columns: { customerId: true } }))?.customerId ?? null;
  }
  const storeId =
    type === "store"
      ? id
      : (await db.query.products.findFirst({ where: eq(products.id, id), columns: { storeId: true } }))?.storeId;
  if (!storeId) return null;
  return (await db.query.stores.findFirst({ where: eq(stores.id, storeId), columns: { ownerId: true } }))?.ownerId ?? null;
}

/** Details an admin needs to judge a reported item. */
export async function describeTarget(type: ReportTarget, id: string) {
  if (type === "product") {
    const p = await db.query.products.findFirst({ where: eq(products.id, id), with: { store: true } });
    return p && { title: p.title, text: p.description, imageUrl: p.imageUrl, hidden: p.imageHidden, href: `/p/${p.id}`, by: p.store.name };
  }
  if (type === "request") {
    const r = await db.query.requests.findFirst({ where: eq(requests.id, id), with: { customer: true } });
    return r && { title: r.title, text: r.description, imageUrl: r.imageUrl, hidden: r.imageHidden, href: `/requests/${r.id}`, by: r.customer.name };
  }
  if (type === "message") {
    const m = await db.query.messages.findFirst({ where: eq(messages.id, id), with: { sender: true } });
    return m && { title: "Chat message", text: m.body, imageUrl: m.imageUrl, hidden: m.imageHidden, href: null, by: m.sender.name };
  }
  const s = await db.query.stores.findFirst({ where: eq(stores.id, id), with: { owner: true } });
  return s && { title: s.name, text: s.description ?? "", imageUrl: s.logoUrl, hidden: false, href: `/s/${s.slug}`, by: s.owner.name };
}
