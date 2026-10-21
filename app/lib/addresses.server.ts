import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { str } from "./utils";

const { addresses } = schema;

export type AddressInput = {
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  area: string;
  city: string;
  landmark: string | null;
};

export class AddressError extends Error {}

export function listAddresses(userId: string) {
  return db.query.addresses.findMany({
    where: eq(addresses.userId, userId),
    orderBy: [desc(addresses.isDefault), desc(addresses.updatedAt)],
  });
}

/** Reads address fields from a form (optionally prefixed, e.g. "new_"). */
export function addressFromForm(form: FormData, prefix = ""): AddressInput {
  const get = (k: string) => str(form.get(prefix + k)).slice(0, 200);
  const a = {
    label: get("label") || "Home",
    recipientName: get("recipientName"),
    phone: get("phone"),
    line1: get("line1"),
    area: get("area"),
    city: get("city"),
    landmark: get("landmark") || null,
  };
  if (a.recipientName.length < 2) throw new AddressError("Enter the recipient's name.");
  if (!/^\+?[\d\s-]{7,}$/.test(a.phone)) throw new AddressError("Enter a valid phone number for the recipient.");
  if (a.line1.length < 3) throw new AddressError("Enter the street, plot or building.");
  if (a.area.length < 2) throw new AddressError("Enter the area (e.g. Area 47, Namiwawa).");
  if (a.city.length < 2) throw new AddressError("Enter the town or city.");
  return a;
}

export async function saveAddress(userId: string, input: AddressInput, id?: string, makeDefault = false) {
  return db.transaction(async (tx) => {
    const isFirst = !(await tx.query.addresses.findFirst({ where: eq(addresses.userId, userId), columns: { id: true } }));
    const isDefault = makeDefault || isFirst;
    if (isDefault) await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
    if (id) {
      const [row] = await tx
        .update(addresses)
        .set({ ...input, ...(isDefault ? { isDefault } : {}), updatedAt: new Date() })
        .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
        .returning();
      if (!row) throw new AddressError("Address not found.");
      return row;
    }
    const [row] = await tx.insert(addresses).values({ ...input, userId, isDefault }).returning();
    return row;
  });
}

export async function deleteAddress(userId: string, id: string) {
  await db.delete(addresses).where(and(eq(addresses.id, id), eq(addresses.userId, userId)));
}

export async function getAddress(userId: string, id: string) {
  return db.query.addresses.findFirst({ where: and(eq(addresses.id, id), eq(addresses.userId, userId)) });
}

/** One-line/multi-line text kept on the order, so later edits to the address book don't change past orders. */
export function formatAddress(a: Pick<AddressInput, "recipientName" | "phone" | "line1" | "area" | "city" | "landmark">) {
  return [`${a.recipientName} · ${a.phone}`, a.line1, `${a.area}, ${a.city}`, a.landmark ? `Landmark: ${a.landmark}` : null]
    .filter(Boolean)
    .join("\n");
}
