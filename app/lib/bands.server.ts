import { and, asc, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { MAX_MONTHS, PHOTO_LIMITS } from "./bands";
import { parseMoney } from "./format";
import { notify, notifyAdmins } from "./notify.server";
import { referenceNumber } from "./orders.server";
import { getSettings, intSetting, setSettings } from "./settings.server";
import { str } from "./utils";

const { listingBands, bandRequests, stores, products } = schema;

export class BandError extends Error {}

const DAY = 86_400_000;

// ---------------------------------------------------------------- photos per listing


/** How many extra photos a listing may have (admin setting). */
export async function maxPhotos() {
  return intSetting(await getSettings(), "max_product_photos", PHOTO_LIMITS.fallback, PHOTO_LIMITS.min);
}

export async function saveMaxPhotos(n: number) {
  if (!Number.isInteger(n) || n < PHOTO_LIMITS.min || n > PHOTO_LIMITS.max) throw new BandError(`Photos per listing must be between ${PHOTO_LIMITS.min} and ${PHOTO_LIMITS.max}.`);
  await setSettings({ max_product_photos: String(n) });
}

// ---------------------------------------------------------------- bands

export function listBands({ activeOnly = false } = {}) {
  return db.query.listingBands.findMany({ where: activeOnly ? eq(listingBands.isActive, true) : undefined, orderBy: [asc(listingBands.position), asc(listingBands.monthlyCents)] });
}

async function defaultBand() {
  const band =
    (await db.query.listingBands.findFirst({ where: and(eq(listingBands.isDefault, true), eq(listingBands.isActive, true)) })) ??
    (await db.query.listingBands.findFirst({ where: eq(listingBands.isActive, true), orderBy: asc(listingBands.monthlyCents) }));
  return band ?? null;
}

/** Admin creates or edits a band. Exactly one band is the free default. */
export async function saveBand(form: FormData) {
  const id = str(form.get("id"));
  const name = str(form.get("name")).slice(0, 40);
  if (name.length < 2) throw new BandError("Give the plan a name.");
  const rawMax = str(form.get("maxItems"));
  const maxItems = rawMax === "" ? null : Number(rawMax);
  if (maxItems !== null && (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 1_000_000)) throw new BandError("Items allowed must be a whole number, or empty for unlimited.");
  const monthly = parseMoney(form.get("monthly")) ?? 0;
  if (monthly < 0) throw new BandError("The price can't be negative.");
  const isDefault = form.get("isDefault") === "on";
  if (isDefault && monthly > 0) throw new BandError("The default plan must be free: it's what every store gets without paying.");
  const values = { name, maxItems, monthlyCents: monthly, isDefault, isActive: form.get("isActive") === "on" || isDefault, position: Number(form.get("position")) || 0 };
  await db.transaction(async (tx) => {
    if (isDefault) await tx.update(listingBands).set({ isDefault: false }).where(id ? ne(listingBands.id, id) : undefined);
    if (id) await tx.update(listingBands).set(values).where(eq(listingBands.id, id));
    else await tx.insert(listingBands).values(values);
  });
  if (!(await defaultBand())) throw new BandError("Keep at least one active plan.");
}

// ---------------------------------------------------------------- a store's plan

/** Listings that count towards the limit: everything not archived. */
export async function listingCount(storeId: string) {
  const [{ n }] = await db.select({ n: count() }).from(products).where(and(eq(products.storeId, storeId), isNull(products.archivedAt)));
  return n;
}

/** The plan in effect for a store: its paid band while paid up, otherwise the free default. */
export async function storePlan(storeId: string) {
  const store = await db.query.stores.findFirst({ where: eq(stores.id, storeId), columns: { listingBandId: true, bandPaidUntil: true }, with: { listingBand: true } });
  const own = store?.listingBand;
  const current = own && own.isActive && (own.monthlyCents === 0 || (store.bandPaidUntil && store.bandPaidUntil > new Date())) ? own : await defaultBand();
  const used = await listingCount(storeId);
  return {
    band: current,
    used,
    limit: current?.maxItems ?? null, // null = unlimited
    paidUntil: own && current?.id === own.id && own.monthlyCents > 0 ? store?.bandPaidUntil ?? null : null,
    expired: !!own && own.monthlyCents > 0 && current?.id !== own.id,
  };
}

/** Refuses a new listing when the store's plan is full. */
export async function assertCanAddListing(storeId: string) {
  const plan = await storePlan(storeId);
  if (plan.limit != null && plan.used >= plan.limit) {
    throw new BandError(
      `Your ${plan.band?.name ?? ""} plan allows ${plan.limit} listing${plan.limit === 1 ? "" : "s"} and you have ${plan.used}. Upgrade under Store plan, or archive or delete a listing first.`,
    );
  }
}

/** Admin puts a store on a band directly (e.g. a free upgrade), optionally until a date. */
export async function adminSetBand(storeId: string, bandId: string | null, months: number | null) {
  const band = bandId ? await db.query.listingBands.findFirst({ where: eq(listingBands.id, bandId) }) : null;
  if (bandId && !band) throw new BandError("Plan not found.");
  const paidUntil = band && band.monthlyCents > 0 ? new Date(Date.now() + (months ?? 1) * 30 * DAY) : null;
  await db.update(stores).set({ listingBandId: band?.id ?? null, bandPaidUntil: paidUntil }).where(eq(stores.id, storeId));
}

// ---------------------------------------------------------------- upgrade requests

export async function requestBand(storeId: string, bandId: string, months: number) {
  const band = await db.query.listingBands.findFirst({ where: and(eq(listingBands.id, bandId), eq(listingBands.isActive, true)) });
  if (!band || band.monthlyCents === 0) throw new BandError("Choose a paid plan.");
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) throw new BandError(`Choose between 1 and ${MAX_MONTHS} months.`);
  const open = await db.query.bandRequests.findFirst({ where: and(eq(bandRequests.storeId, storeId), inArray(bandRequests.status, ["requested", "payment_submitted"])) });
  if (open) throw new BandError("You already have a plan request in progress. Pay for it, or wait for it to be checked.");
  const [row] = await db.insert(bandRequests).values({ number: referenceNumber("LP"), storeId, bandId, months, amountCents: band.monthlyCents * months }).returning();
  return row;
}

export async function submitBandPayment(storeId: string, requestId: string, reference: string, proofUrl: string | null) {
  if (!reference.trim() && !proofUrl) throw new BandError("Enter the payment reference or attach proof of payment.");
  const [row] = await db
    .update(bandRequests)
    .set({ status: "payment_submitted", paymentReference: reference.trim() || null, proofUrl })
    .where(and(eq(bandRequests.id, requestId), eq(bandRequests.storeId, storeId), eq(bandRequests.status, "requested")))
    .returning();
  if (!row) throw new BandError("This request isn't waiting for payment.");
  await notifyAdmins({ title: "Store plan payment to check", body: `${row.number}: ${reference.trim() || "proof attached"}`, href: "/admin/bands" });
}

export async function cancelBandRequest(storeId: string, requestId: string) {
  await db.delete(bandRequests).where(and(eq(bandRequests.id, requestId), eq(bandRequests.storeId, storeId), eq(bandRequests.status, "requested")));
}

/** Admin confirms payment: the store moves to the band; time left on the same band is extended. */
export async function decideBandRequest(requestId: string, approve: boolean, note: string) {
  const r = await db.query.bandRequests.findFirst({ where: eq(bandRequests.id, requestId), with: { band: true, store: { columns: { id: true, ownerId: true, listingBandId: true, bandPaidUntil: true } } } });
  if (!r || !["requested", "payment_submitted"].includes(r.status)) throw new BandError("This request has already been decided.");
  await db.update(bandRequests).set({ status: approve ? "approved" : "rejected", adminNote: note.trim() || null, reviewedAt: new Date() }).where(eq(bandRequests.id, r.id));
  if (!approve) {
    await notify([r.store.ownerId], { title: "Store plan request not approved", body: note.trim() || "We couldn't confirm the payment.", href: "/sell/plan" });
    return;
  }
  const sameBand = r.store.listingBandId === r.bandId && r.store.bandPaidUntil && r.store.bandPaidUntil > new Date();
  const from = sameBand ? r.store.bandPaidUntil! : new Date();
  const until = new Date(from.getTime() + r.months * 30 * DAY);
  await db.update(stores).set({ listingBandId: r.bandId, bandPaidUntil: until }).where(eq(stores.id, r.store.id));
  await notify([r.store.ownerId], { title: `You're on the ${r.band.name} plan`, body: `Up to ${r.band.maxItems ?? "unlimited"} listings until ${until.toISOString().slice(0, 10)}.`, href: "/sell/plan" }, { email: true });
}

export function storeBandRequests(storeId: string) {
  return db.query.bandRequests.findMany({ where: eq(bandRequests.storeId, storeId), orderBy: desc(bandRequests.createdAt), limit: 20, with: { band: { columns: { name: true } } } });
}

export function adminBandRequests() {
  return db.query.bandRequests.findMany({
    where: inArray(bandRequests.status, ["requested", "payment_submitted"]),
    orderBy: desc(bandRequests.createdAt),
    with: { band: { columns: { name: true } }, store: { columns: { id: true, name: true, slug: true } } },
  });
}

export async function pendingBandPayments() {
  const [{ n }] = await db.select({ n: count() }).from(bandRequests).where(eq(bandRequests.status, "payment_submitted"));
  return n;
}

