import { and, desc, eq, sql } from "drizzle-orm";
import { PackageIcon, PencilIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { data, Link, useFetcher } from "react-router";
import { EmptyState, FlashMessage, PageHeader } from "~/components/page";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { db, schema } from "~/db/client.server";
import { qualified } from "~/db/sql";
import { liveAd } from "~/lib/ads.server";
import { getFlash, requireMerchant } from "~/lib/auth.server";
import { money, stockLabel } from "~/lib/format";
import { LISTING_BADGE, soldWord } from "~/lib/property";
import type { Route } from "./+types/sell.products";

export const meta: Route.MetaFunction = () => [{ title: "My products · MyPlug" }];

// Sends the cookie that clears the one-time message on full page loads too.
export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const { products, promotions } = schema;
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      priceCents: products.priceCents,
      quantity: products.quantity,
      trackStock: products.trackStock,
      imageUrl: products.imageUrl,
      imageHidden: products.imageHidden,
      isActive: products.isActive,
      kind: products.kind,
      listingType: products.listingType,
      archivedAt: products.archivedAt,
      archiveWhenSoldOut: products.archiveWhenSoldOut,
      soldAt: products.soldAt,
      promoEnds: sql<Date | null>`(select max(${promotions.endsAt}) from ${promotions}
        where ${qualified(promotions.productId)} = ${qualified(products.id)}
        and ${liveAd})`.mapWith(
        (v) => (v ? new Date(v) : null),
      ),
    })
    .from(products)
    .where(eq(products.storeId, user.storeId))
    .orderBy(desc(products.createdAt));
  const { flash, headers } = await getFlash(request);
  return data({ products: rows, currency: user.storeCurrency, flash }, { headers });
}

/** Inline stock adjustment */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireMerchant(request);
  const form = await request.formData();
  const id = String(form.get("id"));
  const quantity = Math.max(0, Math.floor(Number(form.get("quantity"))));
  if (!Number.isFinite(quantity)) return { error: "Invalid quantity" };
  await db
    .update(schema.products)
    // Restocking brings back a listing that was archived when it sold out.
    .set(quantity > 0 ? { quantity, archivedAt: null } : { quantity })
    .where(and(eq(schema.products.id, id), eq(schema.products.storeId, user.storeId), eq(schema.products.trackStock, true)));
  return { ok: true };
}

function StockInput({ id, quantity }: { id: string; quantity: number }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input
        name="quantity"
        type="number"
        min={0}
        defaultValue={quantity}
        aria-label="Quantity in stock"
        className="h-8 w-16 rounded-lg border-2 bg-background px-2 text-sm outline-none focus:border-primary"
        onBlur={(e) => {
          if (Number(e.currentTarget.value) !== quantity) fetcher.submit(e.currentTarget.form);
        }}
      />
      {fetcher.state !== "idle" ? <span className="text-xs text-muted-foreground">saving…</span> : null}
    </fetcher.Form>
  );
}

export default function SellProducts({ loaderData }: Route.ComponentProps) {
  const { products, currency, flash } = loaderData;
  return (
    <>
      <PageHeader
        title="Products"
        description="Manage what you sell. Edit the quantity inline to restock."
        actions={
          <Button asChild>
            <Link to="/sell/products/new">
              <PlusIcon /> New product
            </Link>
          </Button>
        }
      />
      <FlashMessage flash={flash} />
      {products.length ? (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Product</th>
                <th className="p-3">Price</th>
                <th className="p-3">Quantity</th>
                <th className="p-3">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.map((p) => {
                const stock = stockLabel(p.quantity, p.trackStock);
                return (
                  <tr key={p.id}>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <SafeImage src={p.imageUrl} hidden={p.imageHidden} alt="" className="size-12 shrink-0 rounded-lg" />
                        <div className="grid">
                          <Link to={`/p/${p.id}`} className="font-semibold hover:text-primary">{p.title}</Link>
                          {p.promoEnds ? (
                            <span className="flex items-center gap-1 text-xs text-primary">
                              <SparklesIcon className="size-3" /> Promoted until {p.promoEnds.toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="p-3 font-semibold">{money(p.priceCents, currency)}</td>
                    <td className="p-3">
                      {p.kind === "property" ? (
                        <span className="text-sm text-muted-foreground">{p.listingType ? LISTING_BADGE[p.listingType] : "Property"}</span>
                      ) : p.trackStock ? (
                        <StockInput id={p.id} quantity={p.quantity} />
                      ) : (
                        <span className="text-sm text-muted-foreground" title="Continuous supply: no count kept">∞ Always in stock</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {p.kind === "property" ? (
                          p.soldAt ? <Badge variant="destructive">{soldWord(p.listingType)}</Badge> : <Badge variant="success">On the market</Badge>
                        ) : (
                          <Badge variant={stock.tone === "out" ? "destructive" : stock.tone === "low" ? "warning" : "success"}>{stock.text}</Badge>
                        )}
                        {p.archivedAt ? <Badge variant="muted" title="Hidden from shoppers; deleted after MyPlug's retention period">Archived</Badge> : null}
                        {p.archiveWhenSoldOut && !p.archivedAt ? <Badge variant="muted">Archives when sold out</Badge> : null}
                        {!p.isActive && !p.archivedAt ? <Badge variant="muted">Hidden</Badge> : null}
                        {p.imageHidden ? <Badge variant="destructive">Image under review</Badge> : null}
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <Button asChild variant="ghost" size="icon-sm">
                        <Link to={`/sell/products/${p.id}`} aria-label="Edit">
                          <PencilIcon />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={PackageIcon} title="No products yet">
          <Button asChild className="mt-2">
            <Link to="/sell/products/new">Add your first product</Link>
          </Button>
        </EmptyState>
      )}
    </>
  );
}
