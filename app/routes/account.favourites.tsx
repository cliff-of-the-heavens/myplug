import { HeartIcon } from "lucide-react";
import { Link } from "react-router";
import { Container, EmptyState, PageHeader } from "~/components/page";
import { ProductGrid } from "~/components/product-card";
import { SafeImage } from "~/components/safe-image";
import { FavouriteButton } from "~/components/shopping";
import { Card, CardContent } from "~/components/ui/card";
import { requireCustomer } from "~/lib/auth.server";
import { searchProducts } from "~/lib/catalog.server";
import { listFavourites } from "~/lib/shopping.server";
import type { Route } from "./+types/account.favourites";

export const meta: Route.MetaFunction = () => [{ title: "Favourites · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  const saved = await listFavourites(user.id);
  const productIds = saved.flatMap((f) => (f.product ? [f.product.id] : []));
  // Same cards as everywhere else (current price, sale, stock); hidden or removed listings drop out.
  const products = productIds.length ? await searchProducts({ ids: productIds, limit: 200 }) : [];
  const stores = saved.flatMap((f) => (f.store && f.store.status === "approved" ? [f.store] : []));
  return { products, stores };
}

export default function Favourites({ loaderData }: Route.ComponentProps) {
  const { products, stores } = loaderData;
  return (
    <Container className="py-8">
      <PageHeader title="Favourites" description="Products and stores you've saved." />
      {products.length === 0 && stores.length === 0 ? (
        <EmptyState icon={HeartIcon} title="Nothing saved yet">
          Tap the heart on a product or store to keep it here.
        </EmptyState>
      ) : null}
      {stores.length ? (
        <section className="mb-8 grid gap-3">
          <h2 className="text-lg font-bold">Stores</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stores.map((s) => (
              <Card key={s.id}>
                <CardContent className="flex items-center gap-3 pt-5">
                  <SafeImage src={s.logoUrl} alt="" className="size-12 shrink-0 rounded-xl border" />
                  <div className="grid min-w-0 flex-1">
                    <Link to={`/s/${s.slug}`} className="truncate font-bold hover:text-primary">{s.name}</Link>
                    {s.description ? <p className="truncate text-xs text-muted-foreground">{s.description}</p> : null}
                  </div>
                  <FavouriteButton storeId={s.id} />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
      {products.length ? (
        <section className="grid gap-3">
          <h2 className="text-lg font-bold">Products</h2>
          <ProductGrid products={products} />
        </section>
      ) : null}
    </Container>
  );
}
