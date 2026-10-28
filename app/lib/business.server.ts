import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { today } from "./dates";
import { notify } from "./notify.server";

const { businessLicenses, stores } = schema;

export class LicenseError extends Error {}

/** A licence counts while it's verified and not past its expiry date. */
const current = () => and(eq(businessLicenses.status, "verified"), or(isNull(businessLicenses.expiresOn), sql`${businessLicenses.expiresOn} >= ${today()}`));

/**
 * Store IDs with the green "Registered business" badge: their primary document (registration
 * certificate / business licence) is verified by an admin and hasn't expired.
 */
export async function verifiedStoreIds(storeIds: string[]) {
  if (!storeIds.length) return new Set<string>();
  const rows = await db
    .selectDistinct({ storeId: businessLicenses.storeId })
    .from(businessLicenses)
    .where(and(inArray(businessLicenses.storeId, storeIds), eq(businessLicenses.kind, "primary"), current()));
  return new Set(rows.map((r) => r.storeId));
}

/** What customers may see about a business: registration number, badge, and the licences the admin chose to show. */
export async function publicBusinessInfo(storeId: string) {
  const [store, licenses, verified] = await Promise.all([
    db.query.stores.findFirst({ where: eq(stores.id, storeId), columns: { registrationNumber: true, isTradesperson: true, verifiedAt: true } }),
    db.query.businessLicenses.findMany({
      where: and(eq(businessLicenses.storeId, storeId), eq(businessLicenses.showToCustomers, true), current()),
      orderBy: [asc(businessLicenses.kind), asc(businessLicenses.name)],
      columns: { id: true, kind: true, name: true, number: true, issuer: true, issuedOn: true, expiresOn: true, documentKey: true },
    }),
    verifiedStoreIds([storeId]),
  ]);
  const tradesperson = store?.isTradesperson ?? false;
  return {
    verified: verified.has(storeId),
    merchantVerified: !!store?.verifiedAt, // the admin's "Verified merchant" mark
    tradesperson,
    registrationNumber: store?.registrationNumber ?? null,
    licenses: licenses
      // A tradesperson's primary document is their national ID: it's checked, never published.
      .filter((l) => !(tradesperson && l.kind === "primary"))
      .map(({ documentKey, ...l }) => ({ ...l, hasDocument: !!documentKey })),
  };
}

export function storeLicenses(storeId: string) {
  return db.query.businessLicenses.findMany({
    where: eq(businessLicenses.storeId, storeId),
    orderBy: [asc(businessLicenses.kind), desc(businessLicenses.createdAt)],
  });
}

export type LicenseInput = {
  kind: "primary" | "other";
  name: string;
  number: string | null;
  issuer: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
};

/** Merchant adds or updates a licence. Any change sends it back for verification. */
export async function saveLicense(storeId: string, input: LicenseInput, documentKey: string | null, id?: string) {
  if (input.name.length < 3) throw new LicenseError("Name the document, e.g. \"Certificate of Incorporation\".");
  if (input.expiresOn && input.issuedOn && input.expiresOn < input.issuedOn) throw new LicenseError("The expiry date must be after the issue date.");
  if (id) {
    const existing = await db.query.businessLicenses.findFirst({ where: and(eq(businessLicenses.id, id), eq(businessLicenses.storeId, storeId)) });
    if (!existing) throw new LicenseError("Licence not found.");
    await db
      .update(businessLicenses)
      .set({ ...input, ...(documentKey ? { documentKey } : {}), status: "pending", reviewNote: null, updatedAt: new Date() })
      .where(eq(businessLicenses.id, id));
    return;
  }
  if (!documentKey) throw new LicenseError("Upload a photo or PDF of the document.");
  await db.insert(businessLicenses).values({ storeId, ...input, documentKey });
}

export async function deleteLicense(storeId: string, id: string) {
  await db.delete(businessLicenses).where(and(eq(businessLicenses.id, id), eq(businessLicenses.storeId, storeId)));
}

/** Admin vets a licence and decides whether customers can see it. */
/** An admin marks a store as a verified merchant (or takes the mark away). */
export async function setStoreVerified(storeId: string, verified: boolean, note: string) {
  const store = await db.query.stores.findFirst({ where: eq(stores.id, storeId), columns: { ownerId: true, verifiedAt: true } });
  if (!store) throw new LicenseError("Store not found.");
  if (verified && !(await verifiedStoreIds([storeId])).has(storeId)) {
    throw new LicenseError("Verify the store's primary document (registration certificate, or a handyman's national ID) first.");
  }
  await db
    .update(stores)
    .set({ verifiedAt: verified ? (store.verifiedAt ?? new Date()) : null, verifiedNote: note || null })
    .where(eq(stores.id, storeId));
  await notify(
    [store.ownerId],
    verified
      ? { title: "Your store is now a Verified merchant", body: "Customers see a green tick on your listings.", href: "/sell/business" }
      : { title: "Your Verified merchant mark was removed", body: note || undefined, href: "/sell/business" },
    { email: true },
  );
}

export async function reviewLicense(id: string, action: "verify" | "reject" | "show" | "hide", note: string) {
  const lic = await db.query.businessLicenses.findFirst({ where: eq(businessLicenses.id, id), with: { store: { columns: { ownerId: true } } } });
  if (!lic) throw new LicenseError("Licence not found.");
  if (action === "reject" && !note) throw new LicenseError("Give the merchant a reason.");
  const set =
    action === "verify"
      ? { status: "verified" as const, reviewNote: note || null, reviewedAt: new Date() }
      : action === "reject"
        ? { status: "rejected" as const, reviewNote: note, reviewedAt: new Date(), showToCustomers: false }
        : { showToCustomers: action === "show" };
  await db.update(businessLicenses).set(set).where(eq(businessLicenses.id, id));
  if (action === "verify" || action === "reject") {
    await notify([lic.store.ownerId], {
      title: action === "verify" ? `${lic.name} was verified` : `${lic.name} wasn't accepted`,
      body: note || undefined,
      href: "/sell/business",
    }, { email: true });
  }
}
