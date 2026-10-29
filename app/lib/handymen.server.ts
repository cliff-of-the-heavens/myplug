import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { voteSummaries } from "./votes.server";

const { stores, addresses, categories } = schema;

/** Where the visitor is: their default saved address (or newest one), e.g. "Area 10, Lilongwe". */
export async function placeOf(userId: string | undefined) {
  if (!userId) return null;
  const a = await db.query.addresses.findFirst({
    where: eq(addresses.userId, userId),
    orderBy: [desc(addresses.isDefault), desc(addresses.createdAt)],
    columns: { area: true, city: true },
  });
  return a ? `${a.area}, ${a.city}` : null;
}

/** Words of a place worth matching ("Area 10, Lilongwe" -> ["area 10", "lilongwe"]). */
function placeParts(place: string) {
  return place
    .toLowerCase()
    .split(/[,;/]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
}

/**
 * Approved handymen for the home page strip. Those whose service area (or premises) mentions the
 * visitor's place come first, the most specific match first (area beats town); then the
 * community's favourites. `nearby` says how many actually matched.
 */
export async function handymenNear(place: string | null, limit = 12) {
  const rows = await db
    .select({
      id: stores.id,
      name: stores.name,
      slug: stores.slug,
      logoUrl: stores.logoUrl,
      trades: stores.trades,
      serviceArea: stores.serviceArea,
      physicalAddress: stores.physicalAddress,
      verifiedAt: stores.verifiedAt,
    })
    .from(stores)
    .where(and(eq(stores.isTradesperson, true), eq(stores.status, "approved"), isNull(stores.archivedAt)))
    .orderBy(desc(stores.createdAt))
    .limit(500);
  if (!rows.length) return { place, nearby: 0, handymen: [] };

  const parts = place ? placeParts(place) : [];
  const votes = await voteSummaries(rows.map((r) => r.id));
  const scored = rows.map((r) => {
    const where = `${r.serviceArea ?? ""} ${r.physicalAddress ?? ""}`.toLowerCase();
    // Earlier parts are more specific (area before town), so they weigh more
    const match = parts.reduce((s, p, i) => s + (where.includes(p) ? parts.length - i : 0), 0);
    const v = votes.get(r.id)!;
    return { ...r, match, votes: v, net: v.up - v.down };
  });
  scored.sort((a, b) => b.match - a.match || b.net - a.net || Math.random() - 0.5);
  const picked = scored.slice(0, limit);

  const slugs = [...new Set(picked.flatMap((r) => r.trades))];
  const names = new Map(
    slugs.length
      ? (await db.select({ slug: categories.slug, name: categories.name }).from(categories).where(inArray(categories.slug, slugs))).map((c) => [c.slug, c.name])
      : [],
  );
  return {
    place,
    nearby: scored.filter((r) => r.match > 0).length,
    handymen: picked.map(({ physicalAddress, verifiedAt, net, trades, ...r }) => ({
      ...r,
      verified: verifiedAt != null,
      trades: trades.map((t) => names.get(t)).filter((n): n is string => !!n),
    })),
  };
}
