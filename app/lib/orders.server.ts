import { randomInt } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { OrderStatus, PaymentTiming } from "~/db/schema";
import { addDays, isDateStr, today, type DateStr } from "./dates";
import { BILL_TERMS_DAYS, PREPAY_DAYS } from "./orders";
import { CouponError, refundCouponsForOrder, spendCouponTx } from "./coupons.server";
import { applyPromoCode, countPromoUse, PromoError, salePercents, salePrice } from "./pricing.server";

const { products, stores, orders, orderItems, orderEvents, deliveries, bills, digitalOffers, digitalGrants } = schema;

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export { BILL_TERMS_DAYS, PREPAY_DAYS };

/** Which statuses a merchant may move an order to from its current status. */
export const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  // Shipped = handed to a courier; delivered straight from confirmed/processing = collected from the store.
  confirmed: ["processing", "shipped", "delivered", "cancelled"],
  processing: ["shipped", "delivered", "cancelled"],
  shipped: ["out_for_delivery", "delivered"],
  out_for_delivery: ["delivered"],
  delivered: [],
  cancelled: [],
};

/** Service bookings skip shipping: confirm, then mark done ("delivered") on the day. */
export const BOOKING_NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["delivered", "cancelled"],
  processing: ["delivered", "cancelled"],
  shipped: ["delivered"],
  out_for_delivery: ["delivered"],
  delivered: [],
  cancelled: [],
};

/** Bookings that hold a slot on their day. Pending requests don't, until the provider confirms one. */
export const SLOT_HOLDING: OrderStatus[] = ["confirmed", "processing", "shipped", "out_for_delivery", "delivered"];

export function nextStatuses(order: { status: OrderStatus; kind: "product" | "service" }) {
  return (order.kind === "service" ? BOOKING_NEXT_STATUSES : NEXT_STATUSES)[order.status];
}

export class OrderError extends Error {}

/** Short human-friendly reference such as MP-7K2Q9A (no 0/O/1/I to avoid misreading). */
export function referenceNumber(prefix: string) {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[randomInt(alphabet.length)];
  return `${prefix}-${s}`;
}

/** How many slot-holding bookings a service has on each day in a range. */
export async function bookedCounts(productId: string, from: DateStr, to: DateStr, client: Tx | typeof db = db) {
  const rows = await client
    .select({ day: orders.bookingDate, n: sql<number>`count(*)::int` })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orderItems.productId, productId),
        inArray(orders.status, SLOT_HOLDING),
        sql`${orders.bookingDate} between ${from} and ${to}`,
      ),
    )
    .groupBy(orders.bookingDate);
  return new Map(rows.map((r) => [r.day!, r.n]));
}

type NewOrder = {
  customerId: string;
  /** One product... */
  productId?: string;
  quantity?: number;
  /** ...or several (a cart checkout). All lines must be products from the same store. */
  items?: { productId: string; quantity: number }[];
  shippingAddress: string;
  notes?: string;
  paymentTiming?: PaymentTiming;
  /** Services: the day booked. Recurring orders: the delivery day. */
  bookingDate?: DateStr | null;
  planId?: string;
  /** Recurring plans can pay from prepaid credit: the bill is created already paid with this reference. */
  paidFromCredit?: string;
  /** Digital products: the price option bought. */
  offerId?: string;
  /** The store's promo code, and/or a gift coupon to pay with (cart checkout). */
  promoCode?: string;
  couponCode?: string;
  /** Creates the delivery record (method, courier invitations...). Defaults to a plain one. */
  createDelivery?: (tx: Tx, orderId: string) => Promise<unknown>;
};

/**
 * Creates an order with its items, timeline event, delivery and bill, inside an existing transaction.
 * Prices are worked out here, on the server: live sales, then the promo code, then any gift coupon
 * pays part (or all) of what's left.
 */
export async function createOrderTx(tx: Tx, input: NewOrder) {
  const requested = input.items ?? [{ productId: input.productId ?? "", quantity: input.quantity ?? 0 }];
  if (!requested.length) throw new OrderError("Your cart is empty.");
  for (const r of requested) {
    if (!Number.isInteger(r.quantity) || r.quantity < 1) throw new OrderError("Quantity must be at least 1.");
  }
  // Lock the product rows (in a fixed order, so two orders can't deadlock) so nobody oversells
  // the last unit or the last booking slot.
  const ids = [...new Set(requested.map((r) => r.productId))].sort();
  const locked = await tx.select().from(products).where(inArray(products.id, ids)).orderBy(products.id).for("update");
  if (locked.length !== ids.length || locked.some((p) => !p.isActive)) throw new OrderError("This listing is no longer available.");
  const storeIds = new Set(locked.map((p) => p.storeId));
  if (storeIds.size !== 1) throw new OrderError("Each order is with one store.");
  const product = locked[0];
  const storeId = product.storeId;

  if (locked.some((p) => p.kind === "property")) throw new OrderError("Property isn't ordered: make an offer on the listing instead.");
  const isService = product.kind === "service";
  const isDigital = product.kind === "digital";
  if ((isService || isDigital) && requested.length > 1) throw new OrderError("Book services and buy downloads one at a time.");
  if (requested.length > 1 && locked.some((p) => p.kind !== "product")) throw new OrderError("Only products can be ordered together.");
  const offer = isDigital
    ? (await tx.select().from(digitalOffers).where(and(eq(digitalOffers.id, input.offerId ?? ""), eq(digitalOffers.productId, product.id))))[0]
    : null;
  if (isDigital && !offer) throw new OrderError("Choose how you'd like to buy it.");
  if (isService) {
    if (!isDateStr(input.bookingDate)) throw new OrderError("Choose a date for your booking.");
    if (input.bookingDate <= today()) throw new OrderError("Bookings must be for a future date.");
    if (input.bookingDate > addDays(today(), 365)) throw new OrderError("Bookings can be made up to a year ahead.");
    const booked = (await bookedCounts(product.id, input.bookingDate, input.bookingDate, tx)).get(input.bookingDate) ?? 0;
    if (booked >= (product.dailyCapacity ?? 1)) throw new OrderError("That date is fully booked. Please choose another day.");
  }

  // Live sales (timed deals, store-wide or per-item discounts) set the unit prices.
  const pct = await salePercents(tx, locked.map((p) => ({ productId: p.id, storeId: p.storeId })));
  const lines = requested.map((r) => {
    const p = locked.find((x) => x.id === r.productId)!;
    const quantity = isService || isDigital ? 1 : r.quantity;
    if (p.kind === "product" && p.trackStock && p.quantity < quantity) {
      throw new OrderError(p.quantity === 0 ? `${p.title} is out of stock.` : `Only ${p.quantity} of ${p.title} left in stock.`);
    }
    const unitPrice = offer ? offer.priceCents : salePrice(p.priceCents, pct.get(p.id));
    return { p, quantity, unitPrice, totalCents: unitPrice * quantity };
  });
  for (const l of lines) {
    if (l.p.trackStock && l.p.kind === "product") {
      await tx.update(products).set({ quantity: sql`${products.quantity} - ${l.quantity}` }).where(eq(products.id, l.p.id));
    }
  }

  const subtotal = lines.reduce((s, l) => s + l.totalCents, 0);
  let discount = 0;
  let promo: Awaited<ReturnType<typeof applyPromoCode>> | null = null;
  if (input.promoCode?.trim()) {
    try {
      promo = await applyPromoCode(tx, {
        storeId,
        code: input.promoCode,
        customerId: input.customerId,
        lines: lines.map((l) => ({ productId: l.p.id, totalCents: l.totalCents })),
        lock: true,
      });
    } catch (e) {
      if (e instanceof PromoError) throw new OrderError(e.message);
      throw e;
    }
    discount = promo.discountCents;
    await countPromoUse(tx, promo.deal.id);
  }
  const total = subtotal - discount;

  const [store] = await tx.select({ currency: stores.currency }).from(stores).where(eq(stores.id, storeId));
  // Digital goods are always paid first: access starts once the seller confirms payment.
  const timing = isDigital ? "prepaid" : (input.paymentTiming ?? "on_delivery");
  const [order] = await tx
    .insert(orders)
    .values({
      number: referenceNumber("MP"),
      customerId: input.customerId,
      storeId,
      totalCents: total,
      subtotalCents: subtotal,
      discountCents: discount,
      promoCode: promo?.code ?? null,
      currency: store.currency,
      shippingAddress: input.shippingAddress,
      notes: input.notes || null,
      paymentTiming: timing,
      bookingDate: input.bookingDate ?? null,
      planId: input.planId ?? null,
    })
    .returning();

  await tx.insert(orderItems).values(
    lines.map((l) => ({
      orderId: order.id,
      productId: l.p.id,
      title: offer ? `${l.p.title} (${offer.label})` : l.p.title,
      unitPriceCents: l.unitPrice,
      quantity: l.quantity,
    })),
  );
  if (offer) {
    await tx.insert(digitalGrants).values({
      userId: input.customerId,
      productId: product.id,
      orderId: order.id,
      label: offer.label,
      mode: offer.mode,
      accessDays: offer.accessDays,
      maxViews: offer.maxViews,
    });
  }
  await tx.insert(orderEvents).values({
    orderId: order.id,
    status: "pending",
    note: input.planId ? "Scheduled delivery" : isService ? "Booking requested" : isDigital ? "Purchase placed: awaiting payment" : "Order placed",
    actorId: input.customerId,
  });
  if (input.createDelivery) await input.createDelivery(tx, order.id);
  else if (!isDigital) await tx.insert(deliveries).values({ orderId: order.id }); // nothing to deliver for downloads

  // A gift coupon pays part (or all) of the bill straight away.
  let couponUsed = 0;
  let couponCode: string | null = null;
  if (input.couponCode?.trim()) {
    try {
      const spent = await spendCouponTx(tx, { code: input.couponCode, storeId, orderId: order.id, dueCents: total });
      couponUsed = spent.used;
      couponCode = spent.coupon.code;
    } catch (e) {
      if (e instanceof CouponError) throw new OrderError(e.message);
      throw e;
    }
    if (couponUsed) await tx.update(orders).set({ couponCents: couponUsed }).where(eq(orders.id, order.id));
  }

  // Prepaid: due within PREPAY_DAYS (the merchant won't dispatch until it's paid). Otherwise due a few
  // days after delivery; that date is provisional and is reset when the order is actually delivered.
  const serviceDay = input.bookingDate ? new Date(`${input.bookingDate}T12:00:00Z`) : new Date();
  const dueAt =
    timing === "prepaid"
      ? new Date(Date.now() + PREPAY_DAYS * 86_400_000)
      : new Date(serviceDay.getTime() + BILL_TERMS_DAYS * 86_400_000);
  const due = total - couponUsed;
  const paidBy = input.paidFromCredit ?? (due <= 0 && couponCode ? `Gift coupon ${couponCode}` : null);
  await tx.insert(bills).values({
    orderId: order.id,
    amountCents: due,
    dueAt,
    ...(paidBy ? { status: "paid" as const, paidAt: new Date(), paymentReference: paidBy } : {}),
  });

  return { order: { ...order, couponCents: couponUsed }, product };
}

export function placeOrder(input: NewOrder) {
  return db.transaction(async (tx) => (await createOrderTx(tx, input)).order);
}

export async function updateOrderStatus(input: {
  orderId: string;
  storeId: string;
  status: OrderStatus;
  note?: string;
  actorId: string;
  courier?: string;
  trackingNumber?: string;
  receivedBy?: string;
}) {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    if (!order || order.storeId !== input.storeId) throw new OrderError("Order not found.");
    const [item] = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id)).limit(1);
    const [product] = item?.productId
      ? await tx.select().from(products).where(eq(products.id, item.productId)).for("update")
      : [];
    const isBooking = product?.kind === "service";

    if (!nextStatuses({ status: order.status, kind: isBooking ? "service" : "product" }).includes(input.status)) {
      throw new OrderError(`Can't move ${isBooking ? "a booking" : "an order"} from "${order.status}" to "${input.status}".`);
    }

    // Prepaid orders aren't dispatched (or services performed) until the payment is in.
    const [bill] = await tx.select().from(bills).where(eq(bills.orderId, order.id));
    const dispatching = ["shipped", "out_for_delivery", "delivered"].includes(input.status);
    if (order.paymentTiming === "prepaid" && dispatching && bill?.status !== "paid") {
      throw new OrderError("This order is prepaid. Mark the payment as received before dispatching it.");
    }

    // Confirming a booking takes one of the day's slots, if there's one left.
    let dayNowFull = false;
    if (isBooking && input.status === "confirmed" && order.bookingDate) {
      const booked = (await bookedCounts(product.id, order.bookingDate, order.bookingDate, tx)).get(order.bookingDate) ?? 0;
      const capacity = product.dailyCapacity ?? 1;
      if (booked >= capacity) {
        throw new OrderError("That day is already fully booked. Cancel this request or agree another date with the customer.");
      }
      dayNowFull = booked + 1 >= capacity;
    }

    await tx.update(orders).set({ status: input.status, updatedAt: new Date() }).where(eq(orders.id, order.id));
    await tx.insert(orderEvents).values({
      orderId: order.id,
      status: input.status,
      note: input.note || null,
      actorId: input.actorId,
    });

    // Once a day is full nobody else can book it: decline the other requests so those customers can pick another day.
    if (dayNowFull) {
      const others = await tx
        .select({ id: orders.id })
        .from(orders)
        .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
        .where(
          and(
            eq(orderItems.productId, product.id),
            eq(orders.bookingDate, order.bookingDate!),
            eq(orders.status, "pending"),
            ne(orders.id, order.id),
          ),
        );
      for (const o of others) {
        await tx.update(orders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(orders.id, o.id));
        await tx.insert(orderEvents).values({
          orderId: o.id,
          status: "cancelled",
          note: "This date is now fully booked. Please choose another day.",
          actorId: input.actorId,
        });
        await tx.update(bills).set({ status: "void" }).where(and(eq(bills.orderId, o.id), ne(bills.status, "paid")));
      }
    }

    // Keep the delivery record in step with the order.
    const now = new Date();
    if (input.status === "shipped") {
      await tx
        .update(deliveries)
        .set({
          status: "in_transit",
          dispatchedAt: now,
          courier: input.courier || null,
          trackingNumber: input.trackingNumber || null,
        })
        .where(eq(deliveries.orderId, order.id));
    } else if (input.status === "delivered") {
      await tx
        .update(deliveries)
        .set({ status: "delivered", deliveredAt: now, receivedBy: input.receivedBy || null })
        .where(eq(deliveries.orderId, order.id));
      // Pay-after-delivery bills fall due a set number of days after the actual delivery.
      await tx
        .update(bills)
        .set({ dueAt: new Date(now.getTime() + BILL_TERMS_DAYS * 86_400_000) })
        .where(and(eq(bills.orderId, order.id), eq(bills.status, "unpaid")));
    } else if (input.status === "cancelled") {
      // Return stock and void the bill (a paid bill is left as is, for the merchant to refund).
      for (const line of await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id))) {
        if (!line.productId) continue;
        await tx
          .update(products)
          .set({ quantity: sql`${products.quantity} + ${line.quantity}` })
          .where(and(eq(products.id, line.productId), eq(products.trackStock, true), eq(products.kind, "product")));
      }
      await tx.update(bills).set({ status: "void" }).where(and(eq(bills.orderId, order.id), ne(bills.status, "paid")));
      await refundCouponsForOrder(tx, order.id); // money taken from a gift coupon goes back on it
    }
  });
}
