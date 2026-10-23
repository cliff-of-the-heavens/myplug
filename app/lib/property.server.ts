import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, max, ne, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { money } from "./format";
import { notify } from "./notify.server";
import { soldWord } from "./property";
import { cleanText } from "./reviews.server";
import { getSettings, intSetting, setSettings } from "./settings.server";

const { products, propertyOffers, stores } = schema;

export class PropertyError extends Error {}

const DAY = 86_400_000;
const LIVE_OFFER = inArray(propertyOffers.status, ["pending"]);

async function loadProperty(productId: string) {
  const p = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.kind, "property")),
    with: { store: { columns: { id: true, ownerId: true, name: true, currency: true, status: true } } },
  });
  if (!p) throw new PropertyError("Listing not found.");
  return p;
}

const biddingOpen = (p: { priceType: string | null; biddingEndsAt: Date | null }) => p.priceType !== "reserve" || (!!p.biddingEndsAt && p.biddingEndsAt > new Date());

/** The highest live bid on a listing (reserve listings show it publicly, without the bidder). */
export async function offerStats(productId: string) {
  const [row] = await db
    .select({ n: count(), top: max(propertyOffers.amountCents) })
    .from(propertyOffers)
    .where(and(eq(propertyOffers.productId, productId), LIVE_OFFER));
  return { count: row.n, highestCents: row.top == null ? null : Number(row.top) };
}

/**
 * A customer makes (or improves) an offer. Non-negotiable listings only accept interest at the
 * asking price; bidding listings need a bid above the opening price and the current highest
 * bid, before the closing date. The merchant is notified (never shown the customer's email).
 */
export async function makeOffer(input: { customerId: string; productId: string; amountCents: number | null; message: string }) {
  const p = await loadProperty(input.productId);
  if (!p.isActive || p.archivedAt || p.store.status !== "approved") throw new PropertyError("This listing isn't available any more.");
  if (p.soldAt) throw new PropertyError(`This property has already been ${soldWord(p.listingType).toLowerCase()}.`);
  if (p.store.ownerId === input.customerId) throw new PropertyError("You can't make an offer on your own listing.");
  if (!biddingOpen(p)) throw new PropertyError("Bidding on this property has closed.");

  let amount = input.amountCents ?? 0;
  if (p.priceType === "fixed") amount = p.priceCents; // interest at the asking price
  if (!(amount > 0)) throw new PropertyError("Enter the amount you're offering.");
  if (p.priceType === "reserve") {
    if (amount < p.priceCents) throw new PropertyError(`Bids start at ${money(p.priceCents, p.store.currency)}.`);
    const { highestCents } = await offerStats(p.id);
    if (highestCents != null && amount <= highestCents) {
      throw new PropertyError(`Bid more than the current highest bid of ${money(highestCents, p.store.currency)}.`);
    }
  }
  const message = input.message.trim() ? (await cleanText(input.message.trim())).slice(0, 1000) : null;
  const [offer] = await db
    .insert(propertyOffers)
    .values({ productId: p.id, customerId: input.customerId, amountCents: amount, message })
    .onConflictDoUpdate({
      target: [propertyOffers.productId, propertyOffers.customerId],
      set: { amountCents: amount, message, status: "pending", decidedAt: null, updatedAt: new Date() },
    })
    .returning();
  const word = p.priceType === "reserve" ? "bid" : p.priceType === "fixed" ? "buyer interested" : "offer";
  await notify([p.store.ownerId], {
    title: `New ${word}: ${money(amount, p.store.currency)}`,
    body: p.title,
    href: "/sell/offers",
  });
  return offer;
}

export async function withdrawOffer(customerId: string, offerId: string) {
  const [row] = await db
    .update(propertyOffers)
    .set({ status: "withdrawn", updatedAt: new Date() })
    .where(and(eq(propertyOffers.id, offerId), eq(propertyOffers.customerId, customerId), eq(propertyOffers.status, "pending")))
    .returning();
  if (!row) throw new PropertyError("This offer can't be withdrawn.");
}

/**
 * The merchant accepts an offer (the property is then marked sold/let, every other offer loses,
 * and it's archived the next day) or declines it. Bidding listings can only be decided once
 * bidding has closed, so every bidder gets the full time.
 */
export async function decideOffer(ownerId: string, offerId: string, accept: boolean) {
  const offer = await db.query.propertyOffers.findFirst({ where: eq(propertyOffers.id, offerId) });
  if (!offer) throw new PropertyError("Offer not found.");
  const p = await loadProperty(offer.productId);
  if (p.store.ownerId !== ownerId) throw new PropertyError("Offer not found.");
  if (offer.status !== "pending") throw new PropertyError("This offer has already been decided or withdrawn.");
  if (p.soldAt) throw new PropertyError("This property has already been sold.");
  const now = new Date();
  const word = soldWord(p.listingType).toLowerCase();

  if (!accept) {
    await db.update(propertyOffers).set({ status: "declined", decidedAt: now, updatedAt: now }).where(eq(propertyOffers.id, offer.id));
    await notify([offer.customerId], { title: "Your offer wasn't accepted", body: `${p.title} (${money(offer.amountCents, p.store.currency)})`, href: `/p/${p.id}` });
    return;
  }
  if (p.priceType === "reserve" && biddingOpen(p)) throw new PropertyError("Bidding is still open. You can choose a buyer once it closes.");

  const losers = await db.transaction(async (tx) => {
    // Claim the listing first so two offers can't be accepted at once.
    const [claimed] = await tx.update(products).set({ soldAt: now }).where(and(eq(products.id, p.id), isNull(products.soldAt))).returning({ id: products.id });
    if (!claimed) throw new PropertyError("This property has already been sold.");
    await tx.update(propertyOffers).set({ status: "accepted", decidedAt: now, updatedAt: now }).where(eq(propertyOffers.id, offer.id));
    return tx
      .update(propertyOffers)
      .set({ status: "lost", decidedAt: now, updatedAt: now })
      .where(and(eq(propertyOffers.productId, p.id), ne(propertyOffers.id, offer.id), eq(propertyOffers.status, "pending")))
      .returning({ customerId: propertyOffers.customerId });
  });
  await notify([offer.customerId], { title: `Your offer was accepted!`, body: `${p.store.name} accepted ${money(offer.amountCents, p.store.currency)} for ${p.title}. Message them to arrange the next steps.`, href: `/account/offers` }, { email: true });
  await notify(losers.map((l) => l.customerId), { title: `${p.title} has been ${word}`, body: "The seller chose another offer. Thank you for your interest.", href: `/p/${p.id}` });
}

/** A merchant takes a listing off the market without an offer (e.g. sold elsewhere). */
export async function markSoldElsewhere(ownerId: string, productId: string) {
  const p = await loadProperty(productId);
  if (p.store.ownerId !== ownerId) throw new PropertyError("Listing not found.");
  if (p.soldAt) return;
  const now = new Date();
  await db.update(products).set({ soldAt: now }).where(eq(products.id, p.id));
  const lost = await db
    .update(propertyOffers)
    .set({ status: "lost", decidedAt: now, updatedAt: now })
    .where(and(eq(propertyOffers.productId, p.id), eq(propertyOffers.status, "pending")))
    .returning({ customerId: propertyOffers.customerId });
  await notify(lost.map((l) => l.customerId), { title: `${p.title} is no longer available`, href: `/p/${p.id}` });
}

/** Offers on a store's listings, newest listing first, best offers first. */
export async function storeOffers(storeId: string) {
  const listings = await db.query.products.findMany({
    where: and(eq(products.storeId, storeId), eq(products.kind, "property"), isNull(products.archivedAt)),
    orderBy: desc(products.createdAt),
    columns: { id: true, title: true, priceCents: true, priceType: true, reservePriceCents: true, biddingEndsAt: true, listingType: true, soldAt: true, imageUrl: true },
    with: {
      propertyOffers: {
        orderBy: [desc(propertyOffers.amountCents)],
        // First name only, like reviews: the merchant chats with buyers through MyPlug.
        with: { customer: { columns: { id: true, name: true } } },
      },
    },
  });
  return listings.map((l) => ({
    ...l,
    propertyOffers: l.propertyOffers.map(({ customer, ...o }) => ({ ...o, customerId: customer.id, customerName: customer.name.split(" ")[0] })),
  }));
}

export function myOffers(customerId: string) {
  return db.query.propertyOffers.findMany({
    where: eq(propertyOffers.customerId, customerId),
    orderBy: desc(propertyOffers.updatedAt),
    with: { product: { columns: { id: true, title: true, imageUrl: true, listingType: true, priceType: true, biddingEndsAt: true, soldAt: true }, with: { store: { columns: { name: true, currency: true } } } } },
  });
}

export async function myOfferOn(customerId: string, productId: string) {
  return (await db.query.propertyOffers.findFirst({ where: and(eq(propertyOffers.productId, productId), eq(propertyOffers.customerId, customerId)) })) ?? null;
}

// ---------------------------------------------------------------- archiving and clean-up

export type ListingRetention = { soldPropertyDays: number; soldOutDays: number };

export async function getListingRetention(): Promise<ListingRetention> {
  const s = await getSettings();
  return { soldPropertyDays: intSetting(s, "sold_property_retention_days", 30, 1), soldOutDays: intSetting(s, "sold_out_retention_days", 30, 1) };
}

export async function saveListingRetention(v: ListingRetention) {
  await setSettings({ sold_property_retention_days: String(v.soldPropertyDays), sold_out_retention_days: String(v.soldOutDays) });
}

/**
 * Daily: tells merchants when bidding has closed, archives properties the day after they're
 * sold and products set to "archive when sold out" once they hit zero, puts restocked products
 * back, and permanently deletes archived listings once the admin's retention period has passed.
 * Order history keeps the item titles (order lines don't depend on the listing existing).
 */
export async function runListingCleanup(now = new Date()) {
  const cfg = await getListingRetention();

  const closed = await db
    .update(products)
    .set({ biddingNoticeAt: now })
    .where(and(eq(products.kind, "property"), eq(products.priceType, "reserve"), lte(products.biddingEndsAt, now), isNull(products.biddingNoticeAt), isNull(products.soldAt)))
    .returning({ id: products.id, title: products.title, storeId: products.storeId });
  for (const c of closed) {
    const s = await db.query.stores.findFirst({ where: eq(stores.id, c.storeId), columns: { ownerId: true } });
    const { count: n } = await offerStats(c.id);
    await notify([s?.ownerId], { title: `Bidding closed: ${c.title}`, body: n ? `${n} bid${n === 1 ? "" : "s"} received. Choose the buyer.` : "No bids were received.", href: "/sell/offers" }, { email: true });
  }

  const soldArchived = await db
    .update(products)
    .set({ archivedAt: now, isActive: false })
    .where(and(eq(products.kind, "property"), isNotNull(products.soldAt), lt(products.soldAt, new Date(now.getTime() - DAY)), isNull(products.archivedAt)))
    .returning({ id: products.id });

  const soldOut = await db
    .update(products)
    .set({ archivedAt: now })
    .where(and(eq(products.kind, "product"), eq(products.archiveWhenSoldOut, true), eq(products.trackStock, true), lte(products.quantity, 0), isNull(products.archivedAt)))
    .returning({ id: products.id });

  // Restocked before deletion: back on sale.
  const restored = await db
    .update(products)
    .set({ archivedAt: null })
    .where(and(eq(products.kind, "product"), isNotNull(products.archivedAt), gt(products.quantity, 0)))
    .returning({ id: products.id });

  const deleted = await db
    .delete(products)
    .where(
      sql`${products.archivedAt} is not null and (
        (${products.kind} = 'property' and ${products.archivedAt} < ${new Date(now.getTime() - cfg.soldPropertyDays * DAY)})
        or (${products.kind} = 'product' and ${products.archiveWhenSoldOut} and ${products.archivedAt} < ${new Date(now.getTime() - cfg.soldOutDays * DAY)})
      )`,
    )
    .returning({ id: products.id });

  return { biddingClosed: closed.length, soldArchived: soldArchived.length, soldOutArchived: soldOut.length, restored: restored.length, deleted: deleted.length };
}

