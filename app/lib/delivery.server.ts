import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { HandoverType, PlanDeliveryPrefs, SecondCheck, StoreDeliveryMode } from "~/db/schema";
import { HANDOVER_TYPES, MAX_QUOTE_INVITES, METHOD_LABEL } from "./delivery";
import { AddressError, addressFromForm, formatAddress, getAddress, saveAddress, type AddressInput } from "./addresses.server";
import { notify } from "./notify.server";
import { OrderError, updateOrderStatus } from "./orders.server";
import { uploadPrivate } from "./upload.server";
import { isUuid, str } from "./utils";

const { deliveries, deliveryLogs, courierQuotes, couriers, courierRates, orders, stores, orderItems, users } = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const MAX_VERIFY_ATTEMPTS = 5;

// ---------------------------------------------------------------- checkout input

export type DeliveryInput = {
  method: "merchant" | "merchant_courier" | "courier" | "collection";
  address: AddressInput;
  shippingAddress: string; // formatted snapshot kept on the order
  handover: HandoverType;
  delegateName: string | null;
  delegatePhone: string | null;
  pickupAt: Date | null;
  collectorName: string | null;
  collectorPhone: string | null;
  collectorIdNumber: string | null;
  collectorPhotoKey: string | null;
  verifyMethod: "code" | "phrase";
  phrase: string | null;
  secondCheck: SecondCheck;
  inviteCourierIds: string[]; // couriers asked to quote (bidding)
  directCourierId: string | null; // the customer's usual courier, asked directly
};

/**
 * Reads and checks the delivery part of the order form. The store's delivery mode decides
 * which methods the customer may choose.
 */
export async function deliveryFromForm(form: FormData, userId: string, mode: StoreDeliveryMode, preferredCourierId: string | null): Promise<DeliveryInput> {
  // Address: a saved one, or a new one (optionally saved to the address book).
  let address: AddressInput;
  const addressId = str(form.get("addressId"));
  if (addressId && addressId !== "new") {
    const saved = isUuid(addressId) ? await getAddress(userId, addressId) : null;
    if (!saved) throw new OrderError("Choose a delivery address.");
    address = saved;
  } else {
    try {
      address = addressFromForm(form, "new_");
    } catch (e) {
      if (e instanceof AddressError) throw new OrderError(e.message);
      throw e;
    }
    if (form.get("saveAddress") === "on") await saveAddress(userId, address);
  }

  let method: DeliveryInput["method"] = mode === "customer" ? "collection" : mode;
  if (mode === "customer") {
    const choice = str(form.get("deliveryChoice"));
    method = choice === "quotes" || choice === "direct" ? "courier" : "collection";
  }
  if (method === "merchant_courier" && !preferredCourierId) method = "merchant"; // store hasn't picked a courier yet

  const handover = str(form.get("handover")) as HandoverType;
  if (!HANDOVER_TYPES.includes(handover)) throw new OrderError("Choose how the parcel should be handed over.");
  const delegateName = str(form.get("delegateName")).slice(0, 80) || null;
  const delegatePhone = str(form.get("delegatePhone")).slice(0, 30) || null;
  if (handover === "delegate" && (!delegateName || !delegatePhone)) {
    throw new OrderError("Give the name and phone number of the person receiving it for you.");
  }

  const pickupRaw = str(form.get("pickupAt"));
  const pickupAt = form.get("pickupWhen") === "at" && pickupRaw ? new Date(pickupRaw) : null;
  if (pickupAt && (Number.isNaN(pickupAt.getTime()) || pickupAt.getTime() < Date.now() - 60_000)) {
    throw new OrderError("Choose a pickup time in the future, or leave it as any time.");
  }

  // Someone other than a registered courier collecting for the customer
  let collectorName = null, collectorPhone = null, collectorIdNumber = null, collectorPhotoKey = null;
  if (method === "collection" && form.get("collector") === "someone") {
    collectorName = str(form.get("collectorName")).slice(0, 80) || null;
    collectorPhone = str(form.get("collectorPhone")).slice(0, 30) || null;
    collectorIdNumber = str(form.get("collectorIdNumber")).slice(0, 40) || null;
    if (!collectorName || !collectorPhone || !collectorIdNumber) {
      throw new OrderError("Give the collector's name, phone number and ID number.");
    }
    collectorPhotoKey = await uploadPrivate(form.get("collectorPhoto"), "collectors");
  }

  const verifyMethod = form.get("verifyMethod") === "phrase" ? "phrase" : "code";
  const phrase = verifyMethod === "phrase" ? normalisePhrase(str(form.get("phrase"))) : null;
  if (verifyMethod === "phrase" && (!phrase || phrase.length < 4)) throw new OrderError("Choose a secret phrase of at least 4 characters.");
  const secondCheck = (["none", "phone", "app"].includes(str(form.get("secondCheck"))) ? str(form.get("secondCheck")) : "none") as SecondCheck;

  const choice = str(form.get("deliveryChoice"));
  const inviteCourierIds = method === "courier" && choice === "quotes" ? form.getAll("quoteCourier").map(String).filter(isUuid).slice(0, MAX_QUOTE_INVITES) : [];
  const directCourierId = method === "courier" && choice === "direct" && isUuid(str(form.get("directCourier"))) ? str(form.get("directCourier")) : null;
  if (method === "courier" && !inviteCourierIds.length && !directCourierId) throw new OrderError("Choose at least one courier.");

  return {
    method,
    address,
    shippingAddress: formatAddress(address),
    handover,
    delegateName,
    delegatePhone,
    pickupAt,
    collectorName,
    collectorPhone,
    collectorIdNumber,
    collectorPhotoKey,
    verifyMethod,
    phrase,
    secondCheck,
    inviteCourierIds,
    directCourierId,
  };
}

function normalisePhrase(p: string) {
  return p.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

function hashPhrase(deliveryId: string, phrase: string) {
  return createHmac("sha256", process.env.SESSION_SECRET!).update(`${deliveryId}:${normalisePhrase(phrase)}`).digest("base64url");
}

function handoverCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

async function log(client: Tx | typeof db, deliveryId: string, actorId: string | null, action: string, detail?: string) {
  await client.insert(deliveryLogs).values({ deliveryId, actorId, action, detail: detail ?? null });
}

/** Courier's price estimate for an address (area first, then city). */
async function estimateFor(client: Tx | typeof db, courierId: string, area: string, city: string) {
  const rows = await client
    .select({ area: courierRates.area, estimateCents: courierRates.estimateCents })
    .from(courierRates)
    .where(and(eq(courierRates.courierId, courierId), sql`lower(${courierRates.area}) in (${area.toLowerCase()}, ${city.toLowerCase()})`));
  return rows.find((r) => r.area.toLowerCase() === area.toLowerCase())?.estimateCents ?? rows[0]?.estimateCents ?? null;
}

/** Creates the order's delivery record (and courier invitations) inside the order transaction. */
export async function createDeliveryTx(tx: Tx, orderId: string, input: DeliveryInput) {
  const [delivery] = await tx
    .insert(deliveries)
    .values({
      orderId,
      method: input.method,
      recipientName: input.address.recipientName,
      recipientPhone: input.address.phone,
      area: input.address.area,
      city: input.address.city,
      handover: input.handover,
      delegateName: input.delegateName,
      delegatePhone: input.delegatePhone,
      pickupAt: input.pickupAt,
      collectorName: input.collectorName,
      collectorPhone: input.collectorPhone,
      collectorIdNumber: input.collectorIdNumber,
      collectorPhotoKey: input.collectorPhotoKey,
      verifyMethod: input.verifyMethod,
      handoverCode: input.verifyMethod === "code" ? handoverCode() : null,
      secondCheck: input.secondCheck,
      feePaidBy: input.method === "merchant" || input.method === "merchant_courier" ? "merchant" : input.method === "courier" ? "customer" : null,
    })
    .returning();
  if (input.phrase) await tx.update(deliveries).set({ phraseHash: hashPhrase(delivery.id, input.phrase) }).where(eq(deliveries.id, delivery.id));

  const invite = input.directCourierId ? [input.directCourierId] : input.inviteCourierIds;
  if (invite.length) {
    const approved = await tx.select({ id: couriers.id }).from(couriers).where(and(inArray(couriers.id, invite), eq(couriers.status, "approved")));
    for (const c of approved) {
      await tx.insert(courierQuotes).values({
        deliveryId: delivery.id,
        courierId: c.id,
        direct: !!input.directCourierId,
        estimateCents: await estimateFor(tx, c.id, input.address.area, input.address.city),
      });
    }
    if (!approved.length) throw new OrderError("Those couriers aren't available. Choose another.");
  }
  await log(tx, delivery.id, null, "Delivery created", methodLabel(input.method));
  return delivery;
}

export function methodLabel(m: DeliveryInput["method"]) {
  return METHOD_LABEL[m];
}

/** Turns a repeat order's saved preferences into a delivery for one of its orders. */
export function deliveryFromPrefs(p: PlanDeliveryPrefs, shippingAddress: string): DeliveryInput {
  return {
    method: p.method,
    address: { label: "Repeat order", recipientName: p.recipientName, phone: p.recipientPhone, line1: "", area: p.area, city: p.city, landmark: null },
    shippingAddress,
    handover: p.handover,
    delegateName: p.delegateName ?? null,
    delegatePhone: p.delegatePhone ?? null,
    pickupAt: null,
    collectorName: null,
    collectorPhone: null,
    collectorIdNumber: null,
    collectorPhotoKey: null,
    verifyMethod: "code",
    phrase: null,
    secondCheck: "none",
    inviteCourierIds: [],
    directCourierId: p.method === "courier" ? (p.courierId ?? null) : null,
  };
}

// ---------------------------------------------------------------- lookups

/** Approved couriers, with their estimate for an area when they have one. */
export async function availableCouriers() {
  return db.query.couriers.findMany({
    where: eq(couriers.status, "approved"),
    columns: { id: true, name: true, vehicle: true, reviewedAt: true },
    with: { rates: { columns: { area: true, estimateCents: true } } },
    orderBy: couriers.name,
    limit: 200,
  });
}

/** Couriers this customer has used before, most recent first ("my usual courier"). */
export async function usualCouriers(customerId: string) {
  const rows = await db
    .selectDistinct({ courierId: deliveries.courierId })
    .from(deliveries)
    .innerJoin(orders, eq(orders.id, deliveries.orderId))
    .where(and(eq(orders.customerId, customerId), sql`${deliveries.courierId} is not null`))
    .limit(10);
  return rows.map((r) => r.courierId!);
}

async function deliveryContext(deliveryId: string) {
  const d = await db.query.deliveries.findFirst({
    where: eq(deliveries.id, deliveryId),
    with: { order: { columns: { id: true, number: true, customerId: true, storeId: true, status: true } } },
  });
  if (!d) throw new OrderError("Delivery not found.");
  const store = await db.query.stores.findFirst({ where: eq(stores.id, d.order.storeId), columns: { ownerId: true, name: true } });
  const courierUser = d.courierId
    ? (await db.query.couriers.findFirst({ where: eq(couriers.id, d.courierId), columns: { userId: true, name: true, phone: true } })) ?? null
    : null;
  return { d, store: store!, courierUser };
}

const orderLink = (orderId: string) => `/account/orders/${orderId}`;
const sellLink = (orderId: string) => `/sell/orders/${orderId}`;

// ---------------------------------------------------------------- courier quotes

/** Courier answers an invitation with a confirmed price (or declines it). */
export async function respondToQuote(courierId: string, quoteId: string, input: { priceCents: number | null; note: string; decline: boolean }) {
  const result = await db.transaction(async (tx) => {
    const [q] = await tx.select().from(courierQuotes).where(and(eq(courierQuotes.id, quoteId), eq(courierQuotes.courierId, courierId))).for("update");
    if (!q || q.status !== "invited") throw new OrderError("This request is no longer open.");
    if (input.decline) {
      await tx.update(courierQuotes).set({ status: "declined", note: input.note || null, respondedAt: new Date() }).where(eq(courierQuotes.id, q.id));
      return { q, accepted: false, declined: true };
    }
    if (!input.priceCents || input.priceCents <= 0) throw new OrderError("Enter your delivery price.");
    await tx
      .update(courierQuotes)
      .set({ status: "quoted", quoteCents: input.priceCents, note: input.note || null, respondedAt: new Date() })
      .where(eq(courierQuotes.id, q.id));
    // Asked directly (usual courier, or the store's courier): no bidding, so their price closes the deal.
    if (q.direct) {
      await acceptQuoteTx(tx, q.id, null);
      return { q, accepted: true, declined: false };
    }
    return { q, accepted: false, declined: false };
  });

  const { d, store } = await deliveryContext(result.q.deliveryId);
  const courier = await db.query.couriers.findFirst({ where: eq(couriers.id, courierId), columns: { name: true } });
  if (result.declined) {
    await notify([d.feePaidBy === "merchant" ? store.ownerId : d.order.customerId], {
      title: `${courier?.name} can't deliver order ${d.order.number}`,
      href: d.feePaidBy === "merchant" ? sellLink(d.orderId) : orderLink(d.orderId),
    });
  } else if (result.accepted) {
    await announceCourier(result.q.deliveryId);
  } else {
    await notify([d.order.customerId], {
      title: `New delivery quote for order ${d.order.number}`,
      body: `${courier?.name} can deliver it. Compare quotes and accept one.`,
      href: orderLink(d.orderId),
    }, { email: true });
  }
}

/** Customer accepts one quote: that courier gets the job and the bidding closes. */
export async function acceptQuote(customerId: string, quoteId: string) {
  const deliveryId = await db.transaction((tx) => acceptQuoteTx(tx, quoteId, customerId));
  await announceCourier(deliveryId);
}

async function acceptQuoteTx(tx: Tx, quoteId: string, customerId: string | null) {
  const [q] = await tx.select().from(courierQuotes).where(eq(courierQuotes.id, quoteId)).for("update");
  if (!q || q.status !== "quoted") throw new OrderError("This quote can't be accepted.");
  const [d] = await tx.select().from(deliveries).where(eq(deliveries.id, q.deliveryId)).for("update");
  const [o] = await tx.select({ customerId: orders.customerId }).from(orders).where(eq(orders.id, d.orderId));
  if (customerId && o.customerId !== customerId) throw new OrderError("This quote can't be accepted.");
  if (d.courierId) throw new OrderError("A courier has already been chosen.");
  await tx.update(courierQuotes).set({ status: "accepted" }).where(eq(courierQuotes.id, q.id));
  await tx
    .update(courierQuotes)
    .set({ status: "closed" })
    .where(and(eq(courierQuotes.deliveryId, d.id), ne(courierQuotes.id, q.id), inArray(courierQuotes.status, ["invited", "quoted"])));
  await tx.update(deliveries).set({ courierId: q.courierId, feeCents: q.quoteCents, updatedAt: new Date() }).where(eq(deliveries.id, d.id));
  await log(tx, d.id, customerId, "Courier confirmed", `Price agreed: ${q.quoteCents}`);
  return d.id;
}

/** Everyone is told who's picking up: the merchant gets the courier's details to check at pickup. */
async function announceCourier(deliveryId: string) {
  const { d, store, courierUser } = await deliveryContext(deliveryId);
  if (!courierUser) return;
  await notify([store.ownerId], {
    title: `${courierUser.name} will collect order ${d.order.number}`,
    body: `Courier phone: ${courierUser.phone}. Check their photo on the order before handing over.`,
    href: sellLink(d.orderId),
  }, { email: true });
  await notify([d.order.customerId], { title: `${courierUser.name} will deliver order ${d.order.number}`, href: orderLink(d.orderId) });
  await notify([courierUser.userId], {
    title: `You're delivering order ${d.order.number} for ${store.name}`,
    body: "See the pickup details in your courier dashboard.",
    href: "/courier",
  }, { email: true });
}

/** The store's own courier is asked once the merchant confirms an order. */
export async function inviteStoreCourier(orderId: string) {
  const d = await db.query.deliveries.findFirst({ where: eq(deliveries.orderId, orderId) });
  if (!d || d.method !== "merchant_courier" || d.courierId) return;
  const [o] = await db.select({ storeId: orders.storeId }).from(orders).where(eq(orders.id, orderId));
  const store = await db.query.stores.findFirst({ where: eq(stores.id, o.storeId), columns: { preferredCourierId: true, name: true } });
  if (!store?.preferredCourierId) return;
  const existing = await db.query.courierQuotes.findFirst({ where: and(eq(courierQuotes.deliveryId, d.id), eq(courierQuotes.courierId, store.preferredCourierId)) });
  if (existing) return;
  await db.insert(courierQuotes).values({
    deliveryId: d.id,
    courierId: store.preferredCourierId,
    direct: true,
    estimateCents: await estimateFor(db, store.preferredCourierId, d.area ?? "", d.city ?? ""),
  });
  const c = await db.query.couriers.findFirst({ where: eq(couriers.id, store.preferredCourierId), columns: { userId: true } });
  await notify([c?.userId], { title: `${store.name} has a delivery for you`, body: "Confirm your price to take the job.", href: "/courier" }, { email: true });
}

/** Tells newly invited couriers about a job (called after the order is saved). */
export async function notifyInvitedCouriers(orderId: string) {
  const rows = await db
    .select({ userId: couriers.userId })
    .from(courierQuotes)
    .innerJoin(deliveries, eq(deliveries.id, courierQuotes.deliveryId))
    .innerJoin(couriers, eq(couriers.id, courierQuotes.courierId))
    .where(and(eq(deliveries.orderId, orderId), eq(courierQuotes.status, "invited")));
  await notify(rows.map((r) => r.userId), { title: "New delivery request", body: "Confirm your price to bid for the job.", href: "/courier" }, { email: true });
}

// ---------------------------------------------------------------- pickup

export async function setPickupTime(storeId: string, deliveryId: string, at: Date | null, actorId: string) {
  const { d, courierUser } = await deliveryContext(deliveryId);
  if (d.order.storeId !== storeId) throw new OrderError("Delivery not found.");
  await db.update(deliveries).set({ pickupAt: at, updatedAt: new Date() }).where(eq(deliveries.id, d.id));
  await log(db, d.id, actorId, "Pickup time changed", at ? at.toISOString() : "Any time");
  await notify([d.order.customerId, courierUser?.userId], {
    title: `Pickup time for order ${d.order.number} changed`,
    body: at ? `New time: ${at.toLocaleString("en-GB", { timeZone: "Africa/Blantyre" })}` : "Any time",
    href: orderLink(d.orderId),
  });
}

/** Merchant checks the code or secret phrase the collector gives them. */
export async function verifyCollector(storeId: string, deliveryId: string, given: string, actorId: string) {
  const outcome = await db.transaction(async (tx) => {
    const [d] = await tx.select().from(deliveries).where(eq(deliveries.id, deliveryId)).for("update");
    const [o] = d ? await tx.select().from(orders).where(eq(orders.id, d.orderId)) : [];
    if (!d || o.storeId !== storeId) throw new OrderError("Delivery not found.");
    if (d.pickedUpAt) throw new OrderError("This item has already been handed over.");
    if (d.verifyAttempts >= MAX_VERIFY_ATTEMPTS) throw new OrderError("Too many wrong attempts. Contact the customer before handing anything over.");
    const ok =
      d.verifyMethod === "code"
        ? !!d.handoverCode && given.trim().toUpperCase().replace(/\s/g, "") === d.handoverCode
        : !!d.phraseHash && safeEqual(hashPhrase(d.id, given), d.phraseHash);
    if (!ok) {
      await tx.update(deliveries).set({ verifyAttempts: d.verifyAttempts + 1 }).where(eq(deliveries.id, d.id));
      await log(tx, d.id, actorId, "Wrong code or phrase", `Attempt ${d.verifyAttempts + 1} of ${MAX_VERIFY_ATTEMPTS}`);
      return { ok: false as const, d, o, attempts: d.verifyAttempts + 1 };
    }
    await tx
      .update(deliveries)
      .set({ codeVerifiedAt: new Date(), ...(d.secondCheck === "app" ? { approvalRequestedAt: new Date() } : {}) })
      .where(eq(deliveries.id, d.id));
    await log(tx, d.id, actorId, `${d.verifyMethod === "code" ? "Code" : "Secret phrase"} confirmed`);
    return { ok: true as const, d, o, attempts: d.verifyAttempts };
  });

  if (!outcome.ok) {
    if (outcome.attempts >= 3) {
      await notify([outcome.o.customerId], {
        title: `Someone gave a wrong pickup code for order ${outcome.o.number}`,
        body: "If that wasn't the person you sent, contact the store now.",
        href: orderLink(outcome.o.id),
      }, { email: true });
    }
    throw new OrderError(`That doesn't match. ${MAX_VERIFY_ATTEMPTS - outcome.attempts} attempts left.`);
  }
  if (outcome.d.secondCheck === "app") {
    await notify([outcome.o.customerId], {
      title: `Approve the pickup of order ${outcome.o.number}?`,
      body: "Someone with your pickup code is at the store. Approve only if it's the person you sent.",
      href: orderLink(outcome.o.id),
    }, { email: true });
  }
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Customer approves (or refuses) a pickup when they asked for an extra in-app check. */
export async function answerPickupApproval(customerId: string, deliveryId: string, approve: boolean) {
  const { d, store } = await deliveryContext(deliveryId);
  if (d.order.customerId !== customerId || !d.approvalRequestedAt || d.approvedAt || d.pickedUpAt) {
    throw new OrderError("There's nothing to approve.");
  }
  await db
    .update(deliveries)
    .set(approve ? { approvedAt: new Date(), approvalDeniedAt: null } : { approvalDeniedAt: new Date(), codeVerifiedAt: null, approvalRequestedAt: null })
    .where(eq(deliveries.id, d.id));
  await log(db, d.id, customerId, approve ? "Customer approved the pickup" : "Customer refused the pickup");
  await notify([store.ownerId], {
    title: approve ? `Customer approved the pickup of ${d.order.number}` : `Customer REFUSED the pickup of ${d.order.number}`,
    body: approve ? "You can hand the item over." : "Do not hand the item over. Contact the customer.",
    href: sellLink(d.orderId),
  }, { email: !approve });
}

/**
 * Merchant hands the item over once identity is confirmed (and the customer's extra check
 * passed). Logged, and everyone is told straight away.
 */
export async function releaseItem(storeId: string, deliveryId: string, actorId: string, { phoneConfirmed = false } = {}) {
  const { d, store, courierUser } = await deliveryContext(deliveryId);
  if (d.order.storeId !== storeId) throw new OrderError("Delivery not found.");
  if (d.pickedUpAt) throw new OrderError("Already handed over.");
  if (d.method === "merchant") throw new OrderError("You deliver this order yourself; update its status instead.");
  if (d.method !== "collection" && !d.courierId) throw new OrderError("No courier has been confirmed for this order yet.");
  if (!d.codeVerifiedAt) throw new OrderError("Check the pickup code or secret phrase first.");
  if (d.secondCheck === "app" && !d.approvedAt) throw new OrderError("Wait for the customer to approve this pickup.");
  if (d.secondCheck === "phone" && !phoneConfirmed) throw new OrderError("Call the customer and tick that they confirmed.");

  if (d.order.status === "pending") throw new OrderError("Confirm the order first.");
  const who = d.method === "collection" ? (d.collectorName ? `${d.collectorName} (ID ${d.collectorIdNumber})` : "the customer") : `courier ${courierUser?.name}`;

  // Status first: it refuses (e.g. an unpaid prepaid order) before anything is recorded as handed over.
  // Collection completes the order; a courier pickup means it's on its way.
  await updateOrderStatus({
    orderId: d.orderId,
    storeId,
    status: d.method === "collection" ? "delivered" : "shipped",
    actorId,
    note: `Picked up by ${who}`,
    courier: courierUser?.name,
    receivedBy: d.method === "collection" ? (d.collectorName ?? "Customer") : undefined,
  });
  const now = new Date();
  await db.update(deliveries).set({ pickedUpAt: now, pickupVerifiedById: actorId, updatedAt: now }).where(eq(deliveries.id, d.id));
  await log(db, d.id, actorId, "Item handed over", `To ${who}${d.secondCheck === "phone" ? "; customer confirmed by phone" : ""}`);

  const notice = {
    title: `Order ${d.order.number} was picked up from ${store.name}`,
    body: `Handed over to ${who} at ${now.toLocaleString("en-GB", { timeZone: "Africa/Blantyre" })}. If this wasn't expected, contact the store immediately.`,
  };
  await notify([d.order.customerId], { ...notice, href: orderLink(d.orderId) }, { email: true });
  await notify([store.ownerId], { ...notice, href: sellLink(d.orderId) });
  await notify([courierUser?.userId], { ...notice, href: "/courier" }, { email: true });
}

/** Courier marks the parcel delivered at the destination. */
export async function courierDelivered(courierId: string, deliveryId: string, actorId: string, note: string) {
  const { d, store } = await deliveryContext(deliveryId);
  if (d.courierId !== courierId) throw new OrderError("This isn't your delivery.");
  if (!d.pickedUpAt) throw new OrderError("The store hasn't handed this item over yet.");
  if (d.order.status === "delivered") throw new OrderError("Already delivered.");
  await updateOrderStatus({ orderId: d.orderId, storeId: d.order.storeId, status: "delivered", actorId, note: note || undefined, receivedBy: note || undefined });
  await log(db, d.id, actorId, "Delivered by courier", note);
  const notice = { title: `Order ${d.order.number} was delivered`, body: note || undefined };
  await notify([d.order.customerId], { ...notice, href: orderLink(d.orderId) }, { email: true });
  await notify([store.ownerId], { ...notice, href: sellLink(d.orderId) });
}

export function deliveryLogFor(deliveryId: string) {
  return db
    .select({ id: deliveryLogs.id, action: deliveryLogs.action, detail: deliveryLogs.detail, createdAt: deliveryLogs.createdAt, actor: users.name })
    .from(deliveryLogs)
    .leftJoin(users, eq(users.id, deliveryLogs.actorId))
    .where(eq(deliveryLogs.deliveryId, deliveryId))
    .orderBy(desc(deliveryLogs.createdAt));
}

/** Items a courier is expected to carry for an order. */
export function itemsFor(orderId: string) {
  return db.select({ title: orderItems.title, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, orderId));
}
