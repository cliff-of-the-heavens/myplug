import { and, avg, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { ReviewTarget } from "~/db/schema";
import { notify, notifyAdmins } from "./notify.server";
import { maskObscene, parseWordList, type WordLists } from "./profanity";
import { getSettings, setSettings } from "./settings.server";

const { reviews, orders, stores, couriers, users } = schema;

export class ReviewError extends Error {}

const MAX_COMMENT = 1000;

/** The admin's extra blocked words and allowed words. */
export async function wordLists(): Promise<WordLists> {
  const s = await getSettings();
  return { extra: parseWordList(s.profanity_extra), allow: parseWordList(s.profanity_allow) };
}

export async function getWordSettings() {
  const s = await getSettings();
  return { extra: s.profanity_extra ?? "", allow: s.profanity_allow ?? "" };
}

export async function saveWordSettings(extra: string, allow: string) {
  await setSettings({ profanity_extra: extra.slice(0, 5000), profanity_allow: allow.slice(0, 5000) });
}

export async function cleanText(text: string) {
  return maskObscene(text, await wordLists());
}

/**
 * What the customer can rate from one delivered order: each product on it, the store, and the
 * registered courier who delivered it (if any), with any rating they already left.
 */
export async function reviewableForOrder(customerId: string, orderId: string) {
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, orderId), eq(orders.customerId, customerId)),
    columns: { id: true, status: true, storeId: true },
    with: {
      store: { columns: { id: true, name: true } },
      items: { columns: { productId: true, title: true } },
      delivery: { columns: { courierId: true }, with: { courier: { columns: { id: true, name: true } } } },
    },
  });
  if (!order || order.status !== "delivered") return null;

  const existing = await db.select().from(reviews).where(eq(reviews.orderId, order.id));
  const mine = (key: string) => existing.find((r) => r.targetKey === key) ?? null;

  const targets: { target: ReviewTarget; id: string; name: string; review: (typeof existing)[number] | null }[] = [];
  const seen = new Set<string>();
  for (const it of order.items) {
    if (!it.productId || seen.has(it.productId)) continue;
    seen.add(it.productId);
    targets.push({ target: "product", id: it.productId, name: it.title, review: mine(`product:${it.productId}`) });
  }
  targets.push({ target: "store", id: order.store.id, name: order.store.name, review: mine(`store:${order.store.id}`) });
  const courier = order.delivery?.courier;
  if (courier) targets.push({ target: "courier", id: courier.id, name: courier.name, review: mine(`courier:${courier.id}`) });
  return targets;
}

/** Saves (or updates) the customer's rating and comment. Obscene words are masked. */
export async function submitReview(input: { customerId: string; orderId: string; target: ReviewTarget; targetId: string; rating: number; comment: string }) {
  const rating = Math.round(input.rating);
  if (!(rating >= 1 && rating <= 5)) throw new ReviewError("Choose between 1 and 5 stars.");
  const raw = input.comment.trim();
  if (raw.length > MAX_COMMENT) throw new ReviewError(`Keep comments under ${MAX_COMMENT} characters.`);

  const allowed = await reviewableForOrder(input.customerId, input.orderId);
  if (!allowed) throw new ReviewError("You can rate an order once it has been delivered.");
  const t = allowed.find((a) => a.target === input.target && a.id === input.targetId);
  if (!t) throw new ReviewError("That isn't part of this order.");

  const order = await db.query.orders.findFirst({ where: eq(orders.id, input.orderId), columns: { storeId: true } });
  const comment = raw ? await cleanText(raw) : null;
  const targetKey = `${input.target}:${input.targetId}`;
  const values = {
    target: input.target,
    targetKey,
    // Product and store reviews both carry the store, so merchants see everything about their shop.
    productId: input.target === "product" ? input.targetId : null,
    storeId: input.target === "courier" ? null : order!.storeId,
    courierId: input.target === "courier" ? input.targetId : null,
    customerId: input.customerId,
    orderId: input.orderId,
    rating,
    comment,
  };
  const [row] = await db
    .insert(reviews)
    .values(values)
    .onConflictDoUpdate({
      target: [reviews.orderId, reviews.targetKey],
      // An edit stays hidden if an admin took it down.
      set: { rating, comment, updatedAt: new Date() },
    })
    .returning();

  const owner = await ownerOfReview(row);
  if (owner && !t.review) {
    await notify([owner], { title: `New ${rating}-star review`, body: `${t.name}${comment ? `: "${comment.slice(0, 120)}"` : ""}`, href: input.target === "courier" ? "/courier/reviews" : "/sell/reviews" });
  }
  return row;
}

/** The merchant (store owner) or courier user a review is about. */
async function ownerOfReview(r: { storeId: string | null; courierId: string | null }) {
  if (r.storeId) {
    const s = await db.query.stores.findFirst({ where: eq(stores.id, r.storeId), columns: { ownerId: true } });
    return s?.ownerId ?? null;
  }
  if (r.courierId) {
    const c = await db.query.couriers.findFirst({ where: eq(couriers.id, r.courierId), columns: { userId: true } });
    return c?.userId ?? null;
  }
  return null;
}

async function reviewForOwner(reviewId: string, userId: string) {
  const r = await db.query.reviews.findFirst({ where: eq(reviews.id, reviewId) });
  if (!r || (await ownerOfReview(r)) !== userId) throw new ReviewError("Review not found.");
  return r;
}

/** The merchant or courier asks an admin to check a review (it stays up until an admin decides). */
export async function flagReview(reviewId: string, userId: string, reason: string) {
  const why = reason.trim();
  if (why.length < 5) throw new ReviewError("Tell the admin briefly what's wrong with this review.");
  const r = await reviewForOwner(reviewId, userId);
  if (r.status === "hidden") throw new ReviewError("This review has already been taken down.");
  await db
    .update(reviews)
    .set({ status: "flagged", flagReason: why.slice(0, 500), flaggedById: userId, flaggedAt: new Date(), updatedAt: new Date() })
    .where(eq(reviews.id, r.id));
  await notifyAdmins({ title: "Review flagged for checking", body: why.slice(0, 140), href: "/admin/reviews" });
}

/** The merchant's public reply under a review about their store or products. */
export async function replyToReview(reviewId: string, userId: string, text: string) {
  const r = await reviewForOwner(reviewId, userId);
  if (!r.storeId) throw new ReviewError("Only merchants can reply to reviews.");
  const reply = text.trim().slice(0, MAX_COMMENT);
  await db.update(reviews).set({ reply: reply ? await cleanText(reply) : null, updatedAt: new Date() }).where(eq(reviews.id, r.id));
}

export type ReviewDecision = "hide" | "restore" | "keep";

/** Admin decision: take it down, put it back, or keep it up and clear the flag. */
export async function moderateReview(reviewId: string, decision: ReviewDecision, note: string) {
  const r = await db.query.reviews.findFirst({ where: eq(reviews.id, reviewId) });
  if (!r) throw new ReviewError("Review not found.");
  await db
    .update(reviews)
    .set({ status: decision === "hide" ? "hidden" : "visible", adminNote: note.trim() || null, reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(reviews.id, r.id));
  const outcome = decision === "hide" ? "was taken down" : decision === "restore" ? "was put back up" : "was checked and stays up";
  const href = r.courierId ? "/courier/reviews" : "/sell/reviews";
  if (r.flaggedById) await notify([r.flaggedById], { title: `A review you flagged ${outcome}`, body: note.trim() || undefined, href });
  if (decision === "hide") await notify([r.customerId], { title: "Your review was removed", body: note.trim() || "It didn't meet the community guidelines.", href: `/account/orders/${r.orderId}` });
}

// ---------------------------------------------------------------- reading

/** Reviews that count: everything except taken-down ones. */
const shown = ne(reviews.status, "hidden");

function targetFilter(target: ReviewTarget, id: string) {
  return target === "product" ? eq(reviews.productId, id) : target === "courier" ? eq(reviews.courierId, id) : and(eq(reviews.storeId, id), eq(reviews.target, "store"));
}

export async function ratingSummary(target: ReviewTarget, id: string) {
  const rows = await db
    .select({ rating: reviews.rating, n: count() })
    .from(reviews)
    .where(and(targetFilter(target, id), shown))
    .groupBy(reviews.rating);
  const total = rows.reduce((s, r) => s + r.n, 0);
  const average = total ? rows.reduce((s, r) => s + r.rating * r.n, 0) / total : 0;
  const breakdown = [5, 4, 3, 2, 1].map((stars) => ({ stars, n: rows.find((r) => r.rating === stars)?.n ?? 0 }));
  return { average, total, breakdown };
}

export async function listReviews(target: ReviewTarget, id: string, limit = 20) {
  return db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      comment: reviews.comment,
      reply: reviews.reply,
      createdAt: reviews.createdAt,
      // First name only: reviewers aren't identifiable to strangers.
      reviewer: sql<string>`split_part(${users.name}, ' ', 1)`,
    })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.customerId))
    .where(and(targetFilter(target, id), shown))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
}

/** Average rating and count for many stores at once (store reviews only). */
export async function storeRatings(storeIds: string[]) {
  if (!storeIds.length) return new Map<string, { average: number; total: number }>();
  const rows = await db
    .select({ storeId: reviews.storeId, average: avg(reviews.rating).mapWith(Number), total: count() })
    .from(reviews)
    .where(and(inArray(reviews.storeId, storeIds), eq(reviews.target, "store"), shown))
    .groupBy(reviews.storeId);
  return new Map(rows.map((r) => [r.storeId!, { average: r.average, total: r.total }]));
}

/** Everything said about a merchant's store and its products, or about a courier. */
export async function reviewsFor(owner: { storeId: string } | { courierId: string }, limit = 100) {
  return db.query.reviews.findMany({
    where: "storeId" in owner ? eq(reviews.storeId, owner.storeId) : eq(reviews.courierId, owner.courierId),
    orderBy: desc(reviews.createdAt),
    limit,
    with: { product: { columns: { id: true, title: true } }, customer: { columns: { name: true } } },
  });
}

/** Admin queue: flagged first, then the most recent. */
export async function adminReviews(filter: "flagged" | "hidden" | "all", limit = 100) {
  return db.query.reviews.findMany({
    where: filter === "all" ? undefined : eq(reviews.status, filter),
    orderBy: [sql`case when ${reviews.status} = 'flagged' then 0 else 1 end`, desc(reviews.flaggedAt), desc(reviews.createdAt)],
    limit,
    with: {
      product: { columns: { id: true, title: true } },
      store: { columns: { name: true, slug: true } },
      courier: { columns: { name: true } },
      customer: { columns: { id: true, name: true, email: true } },
    },
  });
}

export async function flaggedReviewCount() {
  const [{ n }] = await db.select({ n: count() }).from(reviews).where(eq(reviews.status, "flagged"));
  return n;
}
