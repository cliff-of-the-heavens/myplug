import { eq } from "drizzle-orm";
import { GiftIcon, PackageOpenIcon } from "lucide-react";
import { data, Link } from "react-router";
import { Container, EmptyState } from "~/components/page";
import { ProductGrid } from "~/components/product-card";
import { ReportButton } from "~/components/report-button";
import { SafeImage } from "~/components/safe-image";
import { db, schema } from "~/db/client.server";
import { BusinessBadge } from "~/components/business-badge";
import { DealCountdown } from "~/components/price";
import { ShareButton } from "~/components/share-button";
import { FavouriteButton } from "~/components/shopping";
import { Button } from "~/components/ui/button";
import { FollowStoreButton } from "~/components/follow-store";
import { getFollowState } from "~/lib/alerts.server";
import { getUser } from "~/lib/auth.server";
import { publicBusinessInfo } from "~/lib/business.server";
import { liveSalesFor } from "~/lib/pricing.server";
import { searchProducts } from "~/lib/catalog.server";
import { date } from "~/lib/format";
import { Card, CardContent } from "~/components/ui/card";
import { RatingSummary, ReviewList, Stars } from "~/components/rating";
import { listReviews, ratingSummary } from "~/lib/reviews.server";
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
  const sales = (await liveSalesFor(store.id)).map((d) => ({ id: d.id, name: d.name, percentOff: d.percentOff, allProducts: d.allProducts, endsAt: d.endsAt }));
  const [ratings, reviewList] = await Promise.all([ratingSummary("store", store.id), listReviews("store", store.id)]);
  return { store: publicStore, products, follow, business, sales, ratings, reviewList };
}

export default function StorePage({ loaderData }: Route.ComponentProps) {
  const { store, products, follow, business, sales, ratings, reviewList } = loaderData;
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
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              {ratings.total ? (
                <a href="#reviews" className="flex items-center gap-1 hover:underline">
                  <Stars value={ratings.average} size="size-3.5" />
                  <span className="font-semibold text-foreground">{ratings.average.toFixed(1)}</span> ({ratings.total})
                </a>
              ) : null}
              {products.length} products · on MyPlug since {date(store.createdAt)}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 pb-1">
            <FavouriteButton storeId={store.id} label="Save store" />
            <ShareButton path={`/s/${store.slug}`} title={store.name} text={`Check out ${store.name} on MyPlug`} />
            {store.couponsEnabled ? (
              <Button asChild variant="outline" size="sm">
                <Link to={`/s/${store.slug}/gift`}><GiftIcon /> Gift coupon</Link>
              </Button>
            ) : null}
            <FollowStoreButton storeId={store.id} storeName={store.name} follow={follow} />
            <ReportButton targetType="store" targetId={store.id} label="Report store" />
          </div>
        </div>
        {store.description ? <p className="max-w-3xl text-muted-foreground">{store.description}</p> : null}
        {sales.length ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-highlight/25 px-4 py-3 text-sm font-semibold">
            {sales.map((d) => (
              <span key={d.id} className="flex flex-wrap items-center gap-2">
                {d.name}: {d.percentOff}% off {d.allProducts ? "everything" : "selected items"}
                {d.endsAt ? <DealCountdown endsAt={d.endsAt} /> : null}
              </span>
            ))}
          </div>
        ) : null}
        {products.length ? (
          <ProductGrid products={products} />
        ) : (
          <EmptyState icon={PackageOpenIcon} title="No products yet">
            This store hasn't listed anything yet. Check back soon!
          </EmptyState>
        )}
        <section id="reviews" className="mt-6 grid scroll-mt-20 gap-3">
          <h2 className="text-xl font-extrabold">What customers say about {store.name}</h2>
          <Card>
            <CardContent className="grid gap-4 pt-5">
              <RatingSummary summary={ratings} />
              <ReviewList reviews={reviewList} />
            </CardContent>
          </Card>
        </section>
      </Container>
    </>
  );
}
