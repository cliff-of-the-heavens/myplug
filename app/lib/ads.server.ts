import { and, asc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db, schema } from "~/db/client.server";
import type { PromotionStatus, PromotionTier } from "~/db/schema";
import { referenceNumber } from "./orders.server";
import { setSettings } from "./settings.server";
import { AD_DURATIONS, bandPrice, MAX_AD_DAYS } from "./promotions";

const { promotions, products, adBands } = schema;

export class AdError extends Error {}

/** SQL condition for adverts that are showing right now. Only admin-approved adverts ever run. */
export const liveAd = and(
  eq(promotions.status, "approved"),
  lte(promotions.startsAt, sql`now()`),
  gte(promotions.endsAt, sql`now()`),
);

export function getBands({ activeOnly = false } = {}) {
  return db.query.adBands.findMany({
    where: activeOnly ? eq(adBands.isActive, true) : undefined,
    orderBy: asc(adBands.weeklyCents),
  });
}

export { getSetting } from "./settings.server";

export function setSetting(key: string, value: string) {
  return setSettings({ [key]: value });
}

export const PAYMENT_INSTRUCTIONS = "payment_instructions";

async function ownedProduct(storeId: string, productId: string) {
  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, storeId), eq(products.isActive, true)),
    columns: { id: true, title: true },
  });
  if (!product) throw new AdError("Choose one of your products.");
  return product;
}

/** Ads belonging to a store, as a condition on promotions. */
function ownedBy(storeId: string) {
  return inArray(
    promotions.productId,
    db.select({ id: products.id }).from(products).where(eq(products.storeId, storeId)),
  );
}

/**
 * Moves an advert to a new status, but only from one of the allowed current statuses.
 * Throws if the advert isn't in a state where that makes sense (e.g. already approved).
 */
async function transition(
  id: string,
  from: PromotionStatus[],
  set: PgUpdateSetSource<typeof promotions>,
  extraWhere?: SQL,
) {
  const [row] = await db
    .update(promotions)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(promotions.id, id), inArray(promotions.status, from), extraWhere))
    .returning();
  if (!row) throw new AdError("This advert can't be changed any more. Refresh to see its latest status.");
  return row;
}

// ---------------------------------------------------------------- merchant

/** Merchant picks an advertised band: billed straight away at the band's price. */
export async function requestBandAd(input: { storeId: string; productId: string; tier: string; days: number }) {
  const band = (await getBands({ activeOnly: true })).find((b) => b.tier === input.tier);
  if (!band || !AD_DURATIONS.includes(input.days)) throw new AdError("Choose a band and duration.");
  const product = await ownedProduct(input.storeId, input.productId);
  const [ad] = await db
    .insert(promotions)
    .values({
      number: referenceNumber("AD"),
      productId: product.id,
      tier: band.tier,
      days: input.days,
      amountCents: bandPrice(band.weeklyCents, input.days),
      status: "awaiting_payment",
    })
    .returning();
  return ad;
}

/** Merchant describes what they want; an admin sets the placement and price. */
export async function requestCustomAd(input: { storeId: string; productId: string; days: number; note: string }) {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_AD_DAYS) {
    throw new AdError(`Choose between 1 and ${MAX_AD_DAYS} days.`);
  }
  if (input.note.length < 10) throw new AdError("Describe the advert you'd like (at least 10 characters).");
  const product = await ownedProduct(input.storeId, input.productId);
  const [ad] = await db
    .insert(promotions)
    .values({
      number: referenceNumber("AD"),
      productId: product.id,
      isCustom: true,
      days: input.days,
      requestNote: input.note.slice(0, 1000),
      status: "pending_quote",
    })
    .returning();
  return ad;
}

/** Merchant reports a payment. Works without a payment gateway: a reference and/or proof file. */
export async function submitPayment(input: { storeId: string; adId: string; reference: string; proofUrl: string | null }) {
  if (!input.reference && !input.proofUrl) throw new AdError("Enter the payment reference or attach proof of payment.");
  return transition(
    input.adId,
    ["awaiting_payment"],
    {
      status: "payment_submitted",
      paymentReference: input.reference.slice(0, 120) || null,
      ...(input.proofUrl ? { proofUrl: input.proofUrl } : {}),
      paymentSubmittedAt: new Date(),
    },
    ownedBy(input.storeId),
  );
}

export function cancelAd(input: { storeId: string; adId: string }) {
  return transition(input.adId, ["pending_quote", "awaiting_payment"], { status: "cancelled" }, ownedBy(input.storeId));
}

// ---------------------------------------------------------------- admin

/** Admin prices a custom request (or re-prices an unpaid one) and bills the merchant. */
export function quoteAd(input: { adminId: string; adId: string; tier: PromotionTier; days: number; amountCents: number; note: string }) {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_AD_DAYS) throw new AdError("Invalid duration.");
  if (input.amountCents <= 0) throw new AdError("Enter the amount to bill.");
  return transition(input.adId, ["pending_quote", "awaiting_payment"], {
    status: "awaiting_payment",
    tier: input.tier,
    days: input.days,
    amountCents: input.amountCents,
    adminNote: input.note || null,
    reviewedById: input.adminId,
  });
}

/** Admin confirms payment was received: the advert starts running now. */
export async function approveAd(input: { adminId: string; adId: string; note: string }) {
  const current = await db.query.promotions.findFirst({ where: eq(promotions.id, input.adId), columns: { status: true } });
  if (current?.status === "pending_quote") throw new AdError("Send the merchant a quote before approving.");
  const now = new Date();
  return transition(
    input.adId,
    ["awaiting_payment", "payment_submitted"],
    {
      status: "approved",
      approvedAt: now,
      reviewedById: input.adminId,
      adminNote: input.note || null,
      startsAt: now,
      endsAt: sql`now() + make_interval(days => ${promotions.days})`,
    },
    // A custom request must be quoted (tier and price set) before it can run.
    and(sql`${promotions.tier} is not null`, sql`${promotions.amountCents} is not null`),
  );
}

/** The proof didn't check out: send it back to the merchant to pay or re-upload. */
export function requestNewPayment(input: { adminId: string; adId: string; note: string }) {
  if (!input.note) throw new AdError("Tell the merchant what's wrong with the payment.");
  return transition(input.adId, ["payment_submitted"], {
    status: "awaiting_payment",
    adminNote: input.note,
    reviewedById: input.adminId,
  });
}

export function rejectAd(input: { adminId: string; adId: string; note: string }) {
  if (!input.note) throw new AdError("Give the merchant a reason.");
  return transition(input.adId, ["pending_quote", "awaiting_payment", "payment_submitted"], {
    status: "rejected",
    adminNote: input.note,
    reviewedById: input.adminId,
  });
}

/** Stops a running advert early. */
export function endAd(input: { adminId: string; adId: string; note: string }) {
  return transition(input.adId, ["approved"], {
    endsAt: new Date(),
    adminNote: input.note || null,
    reviewedById: input.adminId,
  });
}
