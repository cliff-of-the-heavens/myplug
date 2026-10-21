import { eq } from "drizzle-orm";
import { PackageOpenIcon } from "lucide-react";
import { data } from "react-router";
import { Container, EmptyState } from "~/components/page";
import { ProductGrid } from "~/components/product-card";
import { ReportButton } from "~/components/report-button";
import { SafeImage } from "~/components/safe-image";
import { db, schema } from "~/db/client.server";
import { BusinessBadge } from "~/components/business-badge";
import { FollowStoreButton } from "~/components/follow-store";
import { getFollowState } from "~/lib/alerts.server";
import { getUser } from "~/lib/auth.server";
import { publicBusinessInfo } from "~/lib/business.server";
import { searchProducts } from "~/lib/catalog.server";
import { date } from "~/lib/format";
import type { Route } from "./+types/store";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.store.name} · MyPlug` : "Store · MyPlug" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const store = await db.query.stores.findFirst({ where: eq(schema.stores.slug, params.slug) });
  if (!store) throw data("Store not found", { status: 404 });
  if (store.status !== "approved") {
    const user = await getUser(request);
    if (user?.storeId !== store.id && user?.role !== "admin") throw data("Store not found", { status: 404 });
  }
  const [products, follow, business] = await Promise.all([
    searchProducts({ storeId: store.id, sort: "featured", limit: 120 }),
    getFollowState(await getUser(request), store.id),
    publicBusinessInfo(store.id),
  ]);
  const { reviewNote, alertsBlocked, ...publicStore } = store; // admin-only fields stay on the server
  return { store: publicStore, products, follow, business };
}

export default function StorePage({ loaderData }: Route.ComponentProps) {
  const { store, products, follow, business } = loaderData;
  return (
    <>
      <div className="brand-gradient h-32 md:h-44" />
      <Container className="-mt-12 grid gap-8 pb-10">
        <div className="flex flex-wrap items-end gap-4">
          <SafeImage
            src={store.logoUrl}
            alt={store.name}
            className="size-24 rounded-2xl border-4 border-background shadow-lg"
          />
          <div className="grid gap-1 pb-1">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-extrabold tracking-tight md:text-3xl">
              {store.name} <BusinessBadge storeName={store.name} info={business} />
            </h1>
            <p className="text-sm text-muted-foreground">
              {products.length} products · on MyPlug since {date(store.createdAt)}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3 pb-1">
            <FollowStoreButton storeId={store.id} storeName={store.name} follow={follow} />
            <ReportButton targetType="store" targetId={store.id} label="Report store" />
          </div>
        </div>
        {store.description ? <p className="max-w-3xl text-muted-foreground">{store.description}</p> : null}
        {products.length ? (
          <ProductGrid products={products} />
        ) : (
          <EmptyState icon={PackageOpenIcon} title="No products yet">
            This store hasn't listed anything yet. Check back soon!
          </EmptyState>
        )}
      </Container>
    </>
  );
}
