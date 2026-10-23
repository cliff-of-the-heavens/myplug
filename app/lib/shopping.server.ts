import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { salePercents, salePrice } from "./pricing.server";

const { favourites, cartItems, products, stores } = schema;

export class CartError extends Error {}

// ---------------------------------------------------------------- favourites

/** Saved product and store ids, for hearts across the site. */
export async function favouriteIds(userId: string) {
  const rows = await db.select({ productId: favourites.productId, storeId: favourites.storeId }).from(favourites).where(eq(favourites.userId, userId)).limit(1000);
  return {
    products: rows.flatMap((r) => (r.productId ? [r.productId] : [])),
    stores: rows.flatMap((r) => (r.storeId ? [r.storeId] : [])),
  };
}

/** Adds or removes a saved product or store; returns whether it's now saved. */
export async function toggleFavourite(userId: string, target: { productId?: string; storeId?: string }) {
  const where = target.productId
    ? and(eq(favourites.userId, userId), eq(favourites.productId, target.productId))
    : and(eq(favourites.userId, userId), eq(favourites.storeId, target.storeId!));
  const existing = await db.query.favourites.findFirst({ where });
  if (existing) {
    await db.delete(favourites).where(eq(favourites.id, existing.id));
    return false;
  }
  await db.insert(favourites).values({ userId, productId: target.productId ?? null, storeId: target.storeId ?? null }).onConflictDoNothing();
  return true;
}

export function listFavourites(userId: string) {
  return db.query.favourites.findMany({
    where: eq(favourites.userId, userId),
    orderBy: desc(favourites.createdAt),
    with: {
      product: { columns: { id: true, isActive: true }, with: { store: { columns: { status: true } } } },
      store: { columns: { id: true, name: true, slug: true, logoUrl: true, description: true, status: true } },
    },
  });
}

// ---------------------------------------------------------------- cart

export async function cartCount(userId: string) {
  const [{ n }] = await db.select({ n: sql<number>`coalesce(sum(${cartItems.quantity}), 0)::int` }).from(cartItems).where(eq(cartItems.userId, userId));
  return n;
}

/** Adds to the cart (or increases the quantity). Only physical products go in the cart. */
export async function addToCart(userId: string, productId: string, quantity = 1) {
  const p = await db.query.products.findFirst({ where: eq(products.id, productId), with: { store: { columns: { status: true } } } });
  if (!p || !p.isActive || p.store.status !== "approved") throw new CartError("This product isn't available.");
  if (p.kind !== "product") throw new CartError("Services are booked, downloads are bought and property gets offers from their own page.");
  if (!Number.isInteger(quantity) || quantity < 1) throw new CartError("Choose a quantity.");
  await db
    .insert(cartItems)
    .values({ userId, productId, quantity })
    .onConflictDoUpdate({
      target: [cartItems.userId, cartItems.productId],
      set: { quantity: sql`least(${cartItems.quantity} + ${quantity}, 999)`, updatedAt: new Date() },
    });
}

export async function setCartQuantity(userId: string, productId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 0) throw new CartError("Choose a quantity.");
  if (quantity === 0) return removeFromCart(userId, [productId]);
  await db.update(cartItems).set({ quantity: Math.min(quantity, 999), updatedAt: new Date() }).where(and(eq(cartItems.userId, userId), eq(cartItems.productId, productId)));
}

export async function removeFromCart(userId: string, productIds: string[]) {
  for (const productId of productIds) {
    await db.delete(cartItems).where(and(eq(cartItems.userId, userId), eq(cartItems.productId, productId)));
  }
}

/**
 * The cart grouped by store, with current sale prices. Each store is checked out separately,
 * because each store has its own delivery and payment.
 */
export async function getCart(userId: string) {
  const rows = await db
    .select({
      productId: products.id,
      title: products.title,
      imageUrl: products.imageUrl,
      imageHidden: products.imageHidden,
      priceCents: products.priceCents,
      quantity: cartItems.quantity,
      stock: products.quantity,
      trackStock: products.trackStock,
      available: sql<boolean>`${products.isActive} and ${stores.status} = 'approved'`,
      storeId: stores.id,
      storeName: stores.name,
      storeSlug: stores.slug,
      currency: stores.currency,
    })
    .from(cartItems)
    .innerJoin(products, eq(products.id, cartItems.productId))
    .innerJoin(stores, eq(stores.id, products.storeId))
    .where(eq(cartItems.userId, userId))
    .orderBy(asc(stores.name), asc(cartItems.createdAt));

  const pct = await salePercents(db, rows.map((r) => ({ productId: r.productId, storeId: r.storeId })));
  type Line = (typeof rows)[number] & { unitCents: number; lineCents: number; salePct: number | null; problem: string | null };
  const groups = new Map<string, { storeId: string; storeName: string; storeSlug: string; currency: string; lines: Line[]; subtotalCents: number }>();
  for (const r of rows) {
    const unitCents = salePrice(r.priceCents, pct.get(r.productId));
    const problem = !r.available ? "No longer available" : r.trackStock && r.stock < r.quantity ? (r.stock === 0 ? "Out of stock" : `Only ${r.stock} left`) : null;
    const g = groups.get(r.storeId) ?? { storeId: r.storeId, storeName: r.storeName, storeSlug: r.storeSlug, currency: r.currency, lines: [], subtotalCents: 0 };
    g.lines.push({ ...r, unitCents, lineCents: unitCents * r.quantity, salePct: pct.get(r.productId) ?? null, problem });
    if (!problem) g.subtotalCents += unitCents * r.quantity;
    groups.set(r.storeId, g);
  }
  return [...groups.values()];
}
