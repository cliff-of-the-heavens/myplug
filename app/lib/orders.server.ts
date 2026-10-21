import { randomInt } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { OrderStatus, PaymentTiming } from "~/db/schema";
import { addDays, isDateStr, today, type DateStr } from "./dates";
import { BILL_TERMS_DAYS, PREPAY_DAYS } from "./orders";

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
  productId: string;
  quantity: number;
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
  /** Creates the delivery record (method, courier invitations...). Defaults to a plain one. */
  createDelivery?: (tx: Tx, orderId: string) => Promise<unknown>;
};

/** Creates an order with its item, timeline event, delivery and bill, inside an existing transaction. */
export async function createOrderTx(tx: Tx, input: NewOrder) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new OrderError("Quantity must be at least 1.");
  }
  // Lock the product row so two simultaneous orders can't oversell the last unit (or the last booking slot).
  const [product] = await tx.select().from(products).where(eq(products.id, input.productId)).for("update");
  if (!product || !product.isActive) throw new OrderError("This listing is no longer available.");

  const isService = product.kind === "service";
  const isDigital = product.kind === "digital";
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
  } else if (product.trackStock && product.quantity < input.quantity) {
    throw new OrderError(
      product.quantity === 0 ? "This product is out of stock." : `Only ${product.quantity} left in stock.`,
    );
  }

  if (product.trackStock && product.kind === "product") {
    await tx
      .update(products)
      .set({ quantity: sql`${products.quantity} - ${input.quantity}` })
      .where(eq(products.id, product.id));
  }

  const quantity = isService || isDigital ? 1 : input.quantity;
  const [store] = await tx.select({ currency: stores.currency }).from(stores).where(eq(stores.id, product.storeId));
  const unitPrice = offer ? offer.priceCents : product.priceCents;
  const total = unitPrice * quantity;
  // Digital goods are always paid first: access starts once the seller confirms payment.
  const timing = isDigital ? "prepaid" : (input.paymentTiming ?? "on_delivery");
  const [order] = await tx
    .insert(orders)
    .values({
      number: referenceNumber("MP"),
      customerId: input.customerId,
      storeId: product.storeId,
      totalCents: total,
      currency: store.currency,
      shippingAddress: input.shippingAddress,
      notes: input.notes || null,
      paymentTiming: timing,
      bookingDate: input.bookingDate ?? null,
      planId: input.planId ?? null,
    })
    .returning();

  await tx.insert(orderItems).values({
    orderId: order.id,
    productId: product.id,
    title: offer ? `${product.title} (${offer.label})` : product.title,
    unitPriceCents: unitPrice,
    quantity,
  });
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

  // Prepaid: due within PREPAY_DAYS (the merchant won't dispatch until it's paid). Otherwise due a few
  // days after delivery; that date is provisional and is reset when the order is actually delivered.
  const serviceDay = input.bookingDate ? new Date(`${input.bookingDate}T12:00:00Z`) : new Date();
  const dueAt =
    timing === "prepaid"
      ? new Date(Date.now() + PREPAY_DAYS * 86_400_000)
      : new Date(serviceDay.getTime() + BILL_TERMS_DAYS * 86_400_000);
  await tx.insert(bills).values({
    orderId: order.id,
    amountCents: total,
    dueAt,
    ...(input.paidFromCredit ? { status: "paid" as const, paidAt: new Date(), paymentReference: input.paidFromCredit } : {}),
  });

  return { order, product };
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
      if (item?.productId) {
        await tx
          .update(products)
          .set({ quantity: sql`${products.quantity} + ${item.quantity}` })
          .where(and(eq(products.id, item.productId), eq(products.trackStock, true), eq(products.kind, "product")));
      }
      await tx.update(bills).set({ status: "void" }).where(and(eq(bills.orderId, order.id), ne(bills.status, "paid")));
    }
  });
}
