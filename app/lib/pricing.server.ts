import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "~/db/client.server";
import { qualified } from "~/db/sql";
import type { Deal } from "~/db/schema";

const { deals, dealProducts, orders } = schema;

type Client = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A deal that's switched on and within its dates (open-ended when a date is missing). */
export function dealIsLive() {
  return and(
    eq(deals.isActive, true),
    or(isNull(deals.startsAt), lte(deals.startsAt, sql`now()`)),
    or(isNull(deals.endsAt), gte(deals.endsAt, sql`now()`)),
  )!;
}

/**
 * SQL for a product's best live sale (percent off) and when that sale ends, for listings.
 * `productId`/`storeId` are the product's columns in the outer query.
 */
export function saleColumns(productId: AnyPgColumn, storeId: AnyPgColumn) {
  const applies = sql`${qualified(deals.storeId)} = ${qualified(storeId)}
    and ${qualified(deals.kind)} = 'sale' and ${qualified(deals.isActive)}
    and (${qualified(deals.startsAt)} is null or ${qualified(deals.startsAt)} <= now())
    and (${qualified(deals.endsAt)} is null or ${qualified(deals.endsAt)} >= now())
    and (${qualified(deals.allProducts)} or exists (select 1 from ${dealProducts} where ${qualified(dealProducts.dealId)} = ${qualified(deals.id)} and ${qualified(dealProducts.productId)} = ${qualified(productId)}))`;
  return {
    salePct: sql<number | null>`(select max(${qualified(deals.percentOff)}) from ${deals} where ${applies})`.mapWith((v) => (v == null ? null : Number(v))),
    saleEndsAt: sql<Date | null>`(select min(${qualified(deals.endsAt)}) from ${deals} where ${applies})`.mapWith((v) => (v ? new Date(v) : null)),
  };
}

export function salePrice(priceCents: number, pct: number | null | undefined) {
  return pct ? Math.round((priceCents * (100 - pct)) / 100) : priceCents;
}

/** Best live sale percentage for each of the given products (within one or more stores). */
export async function salePercents(client: Client, items: { productId: string; storeId: string }[]) {
  const storeIds = [...new Set(items.map((i) => i.storeId))];
  const result = new Map<string, number>();
  if (!storeIds.length) return result;
  const live = await client.query.deals.findMany({
    where: and(inArray(deals.storeId, storeIds), eq(deals.kind, "sale"), dealIsLive()),
    with: { products: { columns: { productId: true } } },
  });
  for (const i of items) {
    for (const d of live) {
      if (d.storeId !== i.storeId || !d.percentOff) continue;
      if (!d.allProducts && !d.products.some((p) => p.productId === i.productId)) continue;
      result.set(i.productId, Math.max(result.get(i.productId) ?? 0, d.percentOff));
    }
  }
  return result;
}

export class PromoError extends Error {}

/**
 * Checks a promo code for a store and works out the discount on the eligible lines.
 * With `lock`, the deal row is locked (inside the order transaction) so limits hold under load.
 */
export async function applyPromoCode(
  client: Client,
  input: { storeId: string; code: string; customerId: string; lines: { productId: string; totalCents: number }[]; lock?: boolean },
) {
  const code = input.code.trim().toUpperCase();
  const where = and(eq(deals.storeId, input.storeId), eq(deals.kind, "code"), eq(deals.code, code));
  const deal: (Deal & { products?: { productId: string }[] }) | undefined = input.lock
    ? (await client.select().from(deals).where(where).for("update"))[0]
    : await client.query.deals.findFirst({ where });
  if (!deal || !deal.isActive) throw new PromoError("That promo code isn't valid for this store.");
  const now = Date.now();
  if (deal.startsAt && deal.startsAt.getTime() > now) throw new PromoError("That promo code isn't active yet.");
  if (deal.endsAt && deal.endsAt.getTime() < now) throw new PromoError("That promo code has expired.");
  if (deal.maxUses != null && deal.usesCount >= deal.maxUses) throw new PromoError("That promo code has been used up.");
  if (deal.perCustomerLimit != null) {
    const [{ n }] = await client
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.storeId, input.storeId), eq(orders.customerId, input.customerId), eq(orders.promoCode, code), sql`${orders.status} <> 'cancelled'`));
    if (n >= deal.perCustomerLimit) throw new PromoError("You've already used this promo code.");
  }

  let eligibleIds: Set<string> | null = null;
  if (!deal.allProducts) {
    const rows = await client.select({ productId: dealProducts.productId }).from(dealProducts).where(eq(dealProducts.dealId, deal.id));
    eligibleIds = new Set(rows.map((r) => r.productId));
  }
  const eligible = input.lines.filter((l) => !eligibleIds || eligibleIds.has(l.productId)).reduce((sum, l) => sum + l.totalCents, 0);
  if (!eligible) throw new PromoError("That promo code doesn't apply to these items.");
  if (deal.minSpendCents && eligible < deal.minSpendCents) throw new PromoError("Spend a bit more to use this promo code.");
  const discountCents = Math.min(eligible, deal.percentOff ? Math.round((eligible * deal.percentOff) / 100) : (deal.amountOffCents ?? 0));
  return { deal, code, discountCents };
}

/** Records that a promo code was used (inside the order transaction, after applyPromoCode with lock). */
export async function countPromoUse(client: Client, dealId: string) {
  await client.update(deals).set({ usesCount: sql`${deals.usesCount} + 1` }).where(eq(deals.id, dealId));
}

export function liveSalesFor(storeId: string): Promise<(Deal & { products: { productId: string }[] })[]> {
  return db.query.deals.findMany({
    where: and(eq(deals.storeId, storeId), eq(deals.kind, "sale"), dealIsLive()),
    with: { products: { columns: { productId: true } } },
  });
}

