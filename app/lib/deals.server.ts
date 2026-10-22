import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { parseMoney } from "./format";
import { isUuid, str } from "./utils";

const { deals, dealProducts, products } = schema;

export class DealError extends Error {}

export function listDeals(storeId: string) {
  return db.query.deals.findMany({
    where: eq(deals.storeId, storeId),
    orderBy: desc(deals.createdAt),
    with: { products: { with: { product: { columns: { id: true, title: true } } } } },
  });
}

/** Reads and checks the deal form, then saves it. Prices are never changed: deals apply on top. */
export async function createDeal(storeId: string, form: FormData) {
  const kind = form.get("kind") === "code" ? "code" : "sale";
  const name = str(form.get("name")).slice(0, 80);
  if (name.length < 3) throw new DealError("Give the deal a name customers will see, e.g. \"End of month sale\".");

  const percent = Math.floor(Number(form.get("percentOff")));
  const amountOff = kind === "code" && form.get("discountType") === "amount" ? parseMoney(form.get("amountOff")) : null;
  const percentOff = amountOff ? null : percent;
  if (!amountOff && !(percentOff && percentOff >= 1 && percentOff <= 90)) throw new DealError("Choose a discount between 1% and 90%.");

  const parseTime = (k: string) => {
    const raw = str(form.get(k));
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new DealError("Check the start and end times.");
    return d;
  };
  const startsAt = parseTime("startsAt");
  const endsAt = parseTime("endsAt");
  if (startsAt && endsAt && endsAt <= startsAt) throw new DealError("The deal must end after it starts.");
  if (endsAt && endsAt.getTime() < Date.now()) throw new DealError("The end time is in the past.");

  const allProducts = form.get("scope") !== "selected";
  const chosen = form.getAll("productId").map(String).filter(isUuid);
  if (!allProducts && !chosen.length) throw new DealError("Choose the products this deal applies to.");
  // Only this store's own products.
  const own = chosen.length
    ? await db.select({ id: products.id }).from(products).where(and(eq(products.storeId, storeId), inArray(products.id, chosen)))
    : [];
  const productIds = chosen.filter((id) => own.some((p) => p.id === id));

  let code: string | null = null;
  if (kind === "code") {
    code = str(form.get("code")).toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9-]{3,20}$/.test(code)) throw new DealError("Promo codes are 3–20 letters, numbers or dashes.");
    const clash = await db.query.deals.findFirst({ where: and(eq(deals.storeId, storeId), eq(deals.code, code)) });
    if (clash) throw new DealError("You already have a promo code with that name.");
  }
  const positive = (k: string) => {
    const n = Math.floor(Number(form.get(k)));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  await db.transaction(async (tx) => {
    const [deal] = await tx
      .insert(deals)
      .values({
        storeId,
        kind,
        name,
        code,
        percentOff,
        amountOffCents: amountOff,
        allProducts,
        minSpendCents: kind === "code" ? parseMoney(form.get("minSpend")) || null : null,
        startsAt,
        endsAt,
        maxUses: kind === "code" ? positive("maxUses") : null,
        perCustomerLimit: kind === "code" ? positive("perCustomer") : null,
      })
      .returning();
    if (!allProducts) await tx.insert(dealProducts).values(productIds.map((productId) => ({ dealId: deal.id, productId })));
  });
}

export async function setDealActive(storeId: string, dealId: string, active: boolean) {
  await db.update(deals).set({ isActive: active, updatedAt: new Date() }).where(and(eq(deals.id, dealId), eq(deals.storeId, storeId)));
}

export async function deleteDeal(storeId: string, dealId: string) {
  await db.delete(deals).where(and(eq(deals.id, dealId), eq(deals.storeId, storeId)));
}
