import { randomInt } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { Coupon } from "~/db/schema";
import { money } from "./format";
import { notify } from "./notify.server";
import { referenceNumber, type Tx } from "./orders.server";

const { coupons, couponRedemptions, orders, orderItems, orderEvents, bills, stores } = schema;

export class CouponError extends Error {}

/** Hard-to-guess code, grouped for reading aloud at a counter: GIFT-7K2Q-9A4M-XW3D. */
export function newCouponCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const part = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `GIFT-${part()}-${part()}-${part()}`;
}

/** Accepts codes typed with spaces, dashes or lower case. */
export function normaliseCode(code: string) {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = c.startsWith("GIFT") ? c.slice(4) : c;
  return body.length === 12 ? `GIFT-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}` : code.trim().toUpperCase();
}

export type CouponState = "pending" | "active" | "used" | "expired" | "void";

export function couponState(c: Pick<Coupon, "status" | "expiresAt" | "balanceCents">): CouponState {
  if (c.status === "active" && c.expiresAt && c.expiresAt.getTime() < Date.now()) return "expired";
  if (c.status === "active" && c.balanceCents <= 0) return "used";
  return c.status;
}

/** A customer buys a gift coupon: a prepaid order; the coupon goes live when the store confirms payment. */
export async function buyCoupon(input: { customerId: string; storeId: string; amountCents: number; recipientName: string; message: string }) {
  const store = await db.query.stores.findFirst({ where: eq(stores.id, input.storeId) });
  if (!store || store.status !== "approved" || !store.couponsEnabled) throw new CouponError("This store doesn't sell gift coupons.");
  if (!input.amountCents || input.amountCents <= 0) throw new CouponError("Choose an amount.");
  if (store.couponMinCents && input.amountCents < store.couponMinCents) throw new CouponError(`The smallest coupon is ${money(store.couponMinCents, store.currency)}.`);
  if (store.couponMaxCents && input.amountCents > store.couponMaxCents) throw new CouponError(`The largest coupon is ${money(store.couponMaxCents, store.currency)}.`);

  return db.transaction(async (tx) => {
    const [order] = await tx
      .insert(orders)
      .values({
        number: referenceNumber("MP"),
        customerId: input.customerId,
        storeId: store.id,
        totalCents: input.amountCents,
        subtotalCents: input.amountCents,
        currency: store.currency,
        paymentTiming: "prepaid",
        shippingAddress: "Gift coupon (no delivery)",
      })
      .returning();
    await tx.insert(orderItems).values({ orderId: order.id, title: `Gift coupon ${money(input.amountCents, store.currency)}`, unitPriceCents: input.amountCents, quantity: 1 });
    await tx.insert(orderEvents).values({ orderId: order.id, status: "pending", note: "Gift coupon ordered: awaiting payment", actorId: input.customerId });
    await tx.insert(bills).values({ orderId: order.id, amountCents: input.amountCents, dueAt: new Date(Date.now() + 2 * 86_400_000) });
    const [coupon] = await tx
      .insert(coupons)
      .values({
        code: newCouponCode(),
        storeId: store.id,
        purchaserId: input.customerId,
        orderId: order.id,
        initialCents: input.amountCents,
        balanceCents: input.amountCents,
        currency: store.currency,
        recipientName: input.recipientName.slice(0, 80) || null,
        message: input.message.slice(0, 300) || null,
      })
      .returning();
    return { order, coupon };
  });
}

/** Payment confirmed: the coupon becomes usable (called when the store marks the bill paid). */
export async function activateCouponForOrder(orderId: string, actorId: string) {
  const c = await db.query.coupons.findFirst({ where: and(eq(coupons.orderId, orderId), eq(coupons.status, "pending")), with: { store: { columns: { couponValidityDays: true, name: true } } } });
  if (!c) return;
  const now = new Date();
  await db
    .update(coupons)
    .set({ status: "active", activatedAt: now, expiresAt: new Date(now.getTime() + c.store.couponValidityDays * 86_400_000), updatedAt: now })
    .where(eq(coupons.id, c.id));
  await db.update(orders).set({ status: "delivered", updatedAt: now }).where(eq(orders.id, orderId));
  await db.insert(orderEvents).values({ orderId, status: "delivered", note: "Payment received: gift coupon issued", actorId });
  await notify([c.purchaserId], {
    title: `Your ${c.store.name} gift coupon is ready`,
    body: "Open it to see the code and share it with the person it's for.",
    href: `/gift/${c.code}`,
  }, { email: true });
}

export function findCoupon(code: string) {
  return db.query.coupons.findFirst({
    where: eq(coupons.code, normaliseCode(code)),
    with: { store: { columns: { id: true, name: true, slug: true, pickupAddress: true } }, redemptions: { orderBy: desc(couponRedemptions.createdAt), limit: 20 } },
  });
}

/** Locks and checks a coupon for spending at a store. */
async function usableCoupon(tx: Tx, code: string, storeId: string) {
  const [c] = await tx.select().from(coupons).where(eq(coupons.code, normaliseCode(code))).for("update");
  if (!c || c.storeId !== storeId) throw new CouponError("That gift coupon can't be used at this store.");
  const state = couponState(c);
  if (state !== "active") {
    throw new CouponError(
      { pending: "That coupon hasn't been paid for yet.", used: "That coupon has no balance left.", expired: "That coupon has expired.", void: "That coupon was cancelled.", active: "" }[state],
    );
  }
  return c;
}

/** Pays (part of) an online order with a coupon, inside the order transaction. Returns the amount used. */
export async function spendCouponTx(tx: Tx, input: { code: string; storeId: string; orderId: string; dueCents: number }) {
  const c = await usableCoupon(tx, input.code, input.storeId);
  const used = Math.min(c.balanceCents, input.dueCents);
  if (used <= 0) return { used: 0, coupon: c };
  await tx
    .update(coupons)
    .set({ balanceCents: c.balanceCents - used, status: c.balanceCents - used <= 0 ? "used" : "active", updatedAt: new Date() })
    .where(eq(coupons.id, c.id));
  await tx.insert(couponRedemptions).values({ couponId: c.id, orderId: input.orderId, amountCents: used, channel: "online" });
  return { used, coupon: c };
}

/** Merchant takes payment with a coupon at the shop counter. */
export async function redeemInStore(input: { storeId: string; code: string; amountCents: number; staffId: string; note: string }) {
  if (!input.amountCents || input.amountCents <= 0) throw new CouponError("Enter the amount to take from the coupon.");
  const result = await db.transaction(async (tx) => {
    const c = await usableCoupon(tx, input.code, input.storeId);
    if (input.amountCents > c.balanceCents) throw new CouponError(`The coupon only has ${money(c.balanceCents, c.currency)} left.`);
    const balance = c.balanceCents - input.amountCents;
    await tx.update(coupons).set({ balanceCents: balance, status: balance <= 0 ? "used" : "active", updatedAt: new Date() }).where(eq(coupons.id, c.id));
    await tx.insert(couponRedemptions).values({ couponId: c.id, amountCents: input.amountCents, channel: "in_store", staffId: input.staffId, note: input.note.slice(0, 200) || null });
    return { coupon: c, balance };
  });
  // The buyer is told whenever it's used, so a stolen code doesn't go unnoticed.
  await notify([result.coupon.purchaserId], {
    title: `Gift coupon used: ${money(input.amountCents, result.coupon.currency)}`,
    body: `${money(result.balance, result.coupon.currency)} left.`,
    href: `/gift/${result.coupon.code}`,
  });
  return result;
}

/** A cancelled order gives back what it took from a coupon. */
export async function refundCouponsForOrder(tx: Tx, orderId: string) {
  const used = await tx.select().from(couponRedemptions).where(and(eq(couponRedemptions.orderId, orderId), gt(couponRedemptions.amountCents, 0)));
  for (const r of used) {
    const [c] = await tx.select().from(coupons).where(eq(coupons.id, r.couponId)).for("update");
    await tx.update(coupons).set({ balanceCents: c.balanceCents + r.amountCents, status: "active", updatedAt: new Date() }).where(eq(coupons.id, c.id));
    await tx.insert(couponRedemptions).values({ couponId: c.id, orderId, amountCents: -r.amountCents, channel: "online", note: "Order cancelled: refunded to the coupon" });
  }
}

export function myCoupons(userId: string) {
  return db.query.coupons.findMany({
    where: eq(coupons.purchaserId, userId),
    orderBy: desc(coupons.createdAt),
    with: { store: { columns: { name: true, slug: true } } },
  });
}
