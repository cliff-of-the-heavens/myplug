import { and, asc, eq, isNull } from "drizzle-orm";
import { ClipboardListIcon, GiftIcon, MapPinIcon, MessageCircleIcon, PackageOpenIcon } from "lucide-react";
import { data, Form, Link, redirect } from "react-router";
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
import { getUser, requireCustomer } from "~/lib/auth.server";
import { CategoryIcon } from "~/components/category-icon";
import { HandymanVotes, VoteComments } from "~/components/handyman-votes";
import { HANDYMAN_GROUP } from "~/lib/handyman";
import { findOrCreateConversation } from "~/lib/messaging.server";
import { listVoteComments, myVote, voteSummaries } from "~/lib/votes.server";
import { publicBusinessInfo } from "~/lib/business.server";
import { liveSalesFor } from "~/lib/pricing.server";
import { getCategories, searchProducts } from "~/lib/catalog.server";
import { date } from "~/lib/format";
import { Card, CardContent } from "~/components/ui/card";
import { RatingSummary, ReviewList, Stars } from "~/components/rating";
import { listReviews, ratingSummary } from "~/lib/reviews.server";
import { TrackView } from "~/components/tracker";
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
  const user = await getUser(request);
  const [products, follow, business] = await Promise.all([
    searchProducts({ storeId: store.id, sort: "featured", limit: 120 }),
    getFollowState(user, store.id),
    publicBusinessInfo(store.id),
  ]);
  const { reviewNote, alertsBlocked, ...publicStore } = store; // admin-only fields stay on the server
  const sales = (await liveSalesFor(store.id)).map((d) => ({ id: d.id, name: d.name, percentOff: d.percentOff, allProducts: d.allProducts, endsAt: d.endsAt }));
  const [ratings, reviewList, handyman] = await Promise.all([
    ratingSummary("store", store.id),
    listReviews("store", store.id),
    store.isTradesperson ? handymanProfile(store.id, store.trades, user?.id) : null,
  ]);
  return { store: publicStore, products, follow, business, sales, ratings, reviewList, handyman, signedIn: !!user, isOwner: user?.storeId === store.id };
}

/** A tradesperson's trades, portfolio of past work, community votes and comments. */
async function handymanProfile(storeId: string, tradeSlugs: string[], userId: string | undefined) {
  const { products, productImages } = schema;
  const [categories, portfolio, votes, mine, comments] = await Promise.all([
    getCategories(),
    db
      .select({ id: productImages.id, url: productImages.url, title: products.title, productId: products.id })
      .from(productImages)
      .innerJoin(products, eq(products.id, productImages.productId))
      .where(and(eq(products.storeId, storeId), eq(products.isActive, true), isNull(products.archivedAt)))
      .orderBy(asc(productImages.position))
      .limit(12),
    voteSummaries([storeId]),
    myVote(userId, storeId),
    listVoteComments(storeId),
  ]);
  return {
    trades: categories.filter((c) => c.group === HANDYMAN_GROUP && tradeSlugs.includes(c.slug)),
    portfolio,
    votes: votes.get(storeId)!,
    mine: mine && mine.status !== "hidden" ? { value: mine.value, comment: mine.comment } : null,
    comments,
  };
}

/** "Message" on a handyman's profile: a general enquiry thread, not about one listing. */
export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const store = await db.query.stores.findFirst({ where: and(eq(schema.stores.slug, params.slug), eq(schema.stores.status, "approved")) });
  if (!store) throw data("Store not found", { status: 404 });
  const convo = await findOrCreateConversation({ customerId: user.id, storeId: store.id, subject: `Enquiry for ${store.name}` });
  return redirect(`/messages/${convo.id}`);
}

export default function StorePage({ loaderData }: Route.ComponentProps) {
  const { store, products, follow, business, sales, ratings, reviewList, handyman, signedIn, isOwner } = loaderData;
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
              {handyman ? `${products.length} service${products.length === 1 ? "" : "s"}` : `${products.length} products`} · on MyPlug since {date(store.createdAt)}
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
        <TrackView storeId={store.id} />
        {store.description ? <p className="max-w-3xl text-muted-foreground">{store.description}</p> : null}
        {handyman ? (
          <div className="grid gap-4 rounded-2xl border bg-card p-4 md:p-5">
            <div className="flex flex-wrap gap-2">
              {handyman.trades.map((t) => (
                <Link key={t.slug} to={`/search?category=${t.slug}`} className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary hover:bg-primary/20">
                  <CategoryIcon name={t.icon} className="size-4" /> {t.name}
                </Link>
              ))}
              {store.serviceArea ? (
                <span className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm">
                  <MapPinIcon className="size-4" /> Works in {store.serviceArea}
                </span>
              ) : null}
            </div>
            {!isOwner ? (
              <div className="flex flex-wrap gap-2">
                <Form method="post">
                  <Button type="submit">
                    <MessageCircleIcon /> Message
                  </Button>
                </Form>
                <Button asChild variant="outline">
                  <Link to={`/requests/new${handyman.trades[0] ? `?trade=${handyman.trades[0].slug}` : ""}`}>
                    <ClipboardListIcon /> Post a job for quotes
                  </Link>
                </Button>
              </div>
            ) : null}
            <HandymanVotes storeId={store.id} summary={handyman.votes} mine={handyman.mine} signedIn={signedIn} isOwner={isOwner} />
          </div>
        ) : null}
        {handyman?.portfolio.length ? (
          <section className="grid gap-3">
            <h2 className="text-xl font-extrabold">Past work</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {handyman.portfolio.map((p) => (
                <Link key={p.id} to={`/p/${p.productId}`} className="overflow-hidden rounded-xl">
                  <SafeImage src={p.url} alt={p.title} className="aspect-square w-full transition-transform hover:scale-105" />
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        {handyman && store.workReferences ? (
          <section className="grid gap-2">
            <h2 className="text-xl font-extrabold">References</h2>
            <p className="max-w-3xl text-sm whitespace-pre-line text-muted-foreground">{store.workReferences}</p>
          </section>
        ) : null}
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
        {handyman ? (
          <section id="comments" className="mt-6 grid scroll-mt-20 gap-3">
            <h2 className="text-xl font-extrabold">What the community says</h2>
            <Card>
              <CardContent className="pt-5">
                <VoteComments comments={handyman.comments} ownerName={store.name} />
              </CardContent>
            </Card>
          </section>
        ) : null}
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
