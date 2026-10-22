import { and, asc, desc, eq, gt, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { ProductKind, PromotionTier } from "~/db/schema";
import { cached } from "./cache.server";
import { saleColumns } from "./pricing.server";
import { liveAd } from "./ads.server";
import { TIER_WEIGHT } from "./promotions";

const { products, stores, promotions, categories } = schema;

function tierFromWeight(weight: number | null): PromotionTier | null {
  if (!weight) return null;
  return (Object.entries(TIER_WEIGHT).find(([, w]) => w === weight)?.[0] as PromotionTier) ?? null;
}

/** Best currently-running (admin-approved) promotion per product. */
const activePromo = db
  .select({
    productId: promotions.productId,
    // sql.raw keeps the weights as integer literals rather than untyped parameters
    weight: sql<number>`max(case ${promotions.tier}
        when 'premium' then ${sql.raw(String(TIER_WEIGHT.premium))}
        when 'featured' then ${sql.raw(String(TIER_WEIGHT.featured))}
        when 'boost' then ${sql.raw(String(TIER_WEIGHT.boost))} end)`
      .mapWith(Number)
      .as("weight"),
  })
  .from(promotions)
  .where(liveAd)
  .groupBy(promotions.productId)
  .as("active_promo");

/**
 * Weighted random ordering (Efraimidis–Spirakis): each row gets the key
 * -ln(U) / weight with U uniform in (0, 1]; sorting ascending yields a random
 * order in which higher-weight rows tend to appear first. Every product still
 * gets a chance, but paid ads/extras surface far more often. Out-of-stock items
 * are damped so the storefront mostly shows things people can buy.
 */
/** Can be ordered: continuous-supply products are always in stock. */
export const inStock = or(eq(products.trackStock, false), gt(products.quantity, 0))!;

const weightedRandom = sql`-ln(1 - random()) / (
  (1 + coalesce(${activePromo.weight}, 0)) *
  (case when ${inStock} then 1 else 0.25 end)
)`;

const cardColumns = {
  id: products.id,
  title: products.title,
  priceCents: products.priceCents,
  compareAtCents: products.compareAtCents,
  quantity: products.quantity,
  trackStock: products.trackStock,
  kind: products.kind,
  ...saleColumns(products.id, products.storeId), // live sale: salePct, saleEndsAt
  imageUrl: sql<string | null>`case when ${products.imageHidden} then null else ${products.imageUrl} end`,
  storeName: stores.name,
  storeSlug: stores.slug,
  currency: stores.currency,
  promoWeight: activePromo.weight,
};

export type ProductCardData = Omit<
  Awaited<ReturnType<typeof baseQuery>>[number],
  "promoWeight"
> & { promoTier: PromotionTier | null };

function baseQuery(where?: SQL) {
  return db
    .select(cardColumns)
    .from(products)
    .innerJoin(stores, eq(stores.id, products.storeId))
    .leftJoin(activePromo, eq(activePromo.productId, products.id))
    // Only approved stores are visible to shoppers.
    .where(and(eq(products.isActive, true), eq(stores.status, "approved"), where));
}

function toCards(rows: Awaited<ReturnType<typeof baseQuery>>): ProductCardData[] {
  return rows.map(({ promoWeight, ...r }) => ({ ...r, promoTier: tierFromWeight(promoWeight) }));
}

/** Randomised storefront feed, prioritising paid promotions. */
export async function getFeed(limit = 24, where?: SQL) {
  return toCards(await baseQuery(where).orderBy(weightedRandom).limit(limit));
}

/** Only products with an active paid promotion, randomised. */
export async function getSponsored(limit = 8) {
  return toCards(
    await baseQuery(sql`${activePromo.weight} is not null`).orderBy(weightedRandom).limit(limit),
  );
}

export async function getDeals(limit = 8) {
  return toCards(
    await baseQuery(
      and(inStock, sql`${products.compareAtCents} > ${products.priceCents}`),
    )
      .orderBy(weightedRandom)
      .limit(limit),
  );
}

export type SortKey = "featured" | "price-asc" | "price-desc" | "newest";

export async function searchProducts(opts: {
  q?: string;
  categorySlug?: string;
  storeId?: string;
  ids?: string[];
  kind?: ProductKind;
  inStockOnly?: boolean;
  sort?: SortKey;
  limit?: number;
}) {
  const filters: (SQL | undefined)[] = [];
  if (opts.q) {
    const term = `%${opts.q.replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(or(ilike(products.title, term), ilike(products.description, term), ilike(stores.name, term)));
  }
  if (opts.categorySlug) {
    filters.push(
      sql`${products.categoryId} = (select ${categories.id} from ${categories} where ${categories.slug} = ${opts.categorySlug})`,
    );
  }
  if (opts.storeId) filters.push(eq(products.storeId, opts.storeId));
  if (opts.kind) filters.push(eq(products.kind, opts.kind));
  if (opts.ids) filters.push(inArray(products.id, opts.ids));
  if (opts.inStockOnly) filters.push(inStock);

  const order = {
    featured: weightedRandom,
    "price-asc": asc(products.priceCents),
    "price-desc": desc(products.priceCents),
    newest: desc(products.createdAt),
  }[opts.sort ?? "featured"];

  return toCards(
    await baseQuery(and(...filters))
      .orderBy(order)
      .limit(opts.limit ?? 60),
  );
}

/** Read on every page (header), so cached briefly per server instance. */
export function getCategories() {
  return cached("categories", 5 * 60_000, () => db.select().from(categories).orderBy(asc(categories.name)));
}

/** Randomised bookable services, with paid promotions first. */
export async function getServices(limit = 10) {
  return getFeed(limit, eq(products.kind, "service"));
}
