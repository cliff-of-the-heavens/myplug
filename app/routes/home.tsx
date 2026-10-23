import { eq } from "drizzle-orm";
import {
  ArrowRightIcon,
  HouseIcon,
  ImagePlusIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  PartyPopperIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TruckIcon,
} from "lucide-react";
import { Link, useRouteLoaderData } from "react-router";
import { CategoryIcon, TILE_COLORS } from "~/components/category-icon";
import { Container } from "~/components/page";
import { ProductGrid, ProductShelf } from "~/components/product-card";
import { Button } from "~/components/ui/button";
import { schema } from "~/db/client.server";
import { getDeals, getFeed, getProperties, getServices, getSponsored } from "~/lib/catalog.server";
import { useOptionalUser } from "~/lib/hooks";
import type { loader as rootLoader } from "~/root";
import { BannerSlot, HeroCarousel, TopShopsPanel } from "~/components/banner-ads";
import { bannerSettings, pageBanners, topShops } from "~/lib/banners.server";
import type { Route } from "./+types/home";

export async function loader({ request }: Route.LoaderArgs) {
  const settings = await bannerSettings();
  const [sponsored, deals, feed, services, banners, shops, properties] = await Promise.all([
    getSponsored(10),
    getDeals(10),
    getFeed(30, eq(schema.products.kind, "product")),
    getServices(10),
    pageBanners(request, ["hero", "home_banner"]),
    topShops(settings.heroPanel),
    getProperties(10),
  ]);
  return { sponsored, deals, feed, services, banners, shops, properties, heroPanel: settings.heroPanel };
}

// The feed is randomised per visit, so don't let CDNs cache it.
export function headers() {
  return { "Cache-Control": "private, no-store" };
}

function Hero() {
  const user = useOptionalUser();
  return (
    <section className="brand-gradient relative h-full overflow-hidden rounded-3xl px-6 py-10 text-white md:px-12 md:py-16">
      <div className="pointer-events-none absolute -top-16 -right-16 size-64 rounded-full bg-highlight/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 size-72 rounded-full bg-accent/40 blur-3xl" />
      <div className="relative grid max-w-2xl gap-5">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">
          <SparklesIcon className="size-3.5" /> Hundreds of local merchants, one plug
        </span>
        <h1 className="text-4xl leading-[1.05] font-black tracking-tight md:text-6xl">
          Find it. Order it.
          <br />
          <span className="text-highlight">Or ask someone to make it.</span>
        </h1>
        <p className="max-w-lg text-base text-white/90 md:text-lg">
          Shop merchants near you, track every order to your door, and post a photo of anything you need — sellers
          will come to you.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" variant="highlight">
            <Link to="/search">
              Start shopping <ArrowRightIcon />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20">
            <Link to={user?.role === "merchant" ? "/sell" : "/requests/new"}>
              {user?.role === "merchant" ? "Go to my store" : "Post a request"}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Perks() {
  const perks = [
    { icon: TruckIcon, title: "Live order tracking", text: "From confirmed to delivered" },
    { icon: MessageCircleIcon, title: "Chat with sellers", text: "Ask, negotiate, customise" },
    { icon: ImagePlusIcon, title: "Special requests", text: "Snap a photo, get offers" },
    { icon: ShieldCheckIcon, title: "Moderated & safe", text: "Report anything, we act fast" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {perks.map((p, i) => (
        <div key={p.title} className="flex items-center gap-3 rounded-xl border bg-card p-3">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${TILE_COLORS[i]}`}>
            <p.icon className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold">{p.title}</p>
            <p className="truncate text-xs text-muted-foreground">{p.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  href,
  icon,
  children,
}: {
  title: string;
  href?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight md:text-2xl">
          {icon}
          {title}
        </h2>
        {href ? (
          <Link to={href} className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            See all <ArrowRightIcon className="size-4" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { sponsored, deals, feed, services, banners, shops, properties, heroPanel } = loaderData;
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const productCategories = root?.categories.filter((c) => c.kind === "product") ?? [];
  const serviceCategories = root?.categories.filter((c) => c.kind === "service") ?? [];
  const propertyCategories = root?.categories.filter((c) => c.kind === "property") ?? [];

  return (
    <Container className="grid gap-10 py-6 md:gap-12 md:py-8">
      <div className={shops.length && heroPanel !== "off" ? "grid gap-4 lg:grid-cols-[1fr_20rem]" : undefined}>
        <HeroCarousel house={<Hero />} ads={banners.hero ?? []} />
        {heroPanel !== "off" ? <TopShopsPanel shops={shops} mode={heroPanel} /> : null}
      </div>
      <Perks />

      <Section title="Shop by category">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-10">
          {productCategories.map((c, i) => (
            <Link
              key={c.id}
              to={`/search?category=${c.slug}`}
              className="group flex flex-col items-center gap-2 rounded-xl p-2 text-center"
            >
              <span
                className={`flex size-16 items-center justify-center rounded-2xl transition-transform group-hover:-translate-y-1 group-hover:rotate-3 ${TILE_COLORS[i % TILE_COLORS.length]}`}
              >
                <CategoryIcon name={c.icon} className="size-7" />
              </span>
              <span className="text-xs font-semibold">{c.name}</span>
            </Link>
          ))}
        </div>
      </Section>

      <BannerSlot ads={banners.home_banner} shape="strip" />

      <Section title="Book a service" href="/search?kind=service" icon={<PartyPopperIcon className="size-5 text-primary" />}>
        <div className="grid gap-4">
          <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
            {serviceCategories.map((c, i) => (
              <Link
                key={c.id}
                to={`/search?category=${c.slug}`}
                className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${TILE_COLORS[i % TILE_COLORS.length]}`}
              >
                <CategoryIcon name={c.icon} className="size-4" /> {c.name}
              </Link>
            ))}
          </div>
          {services.length ? <ProductShelf products={services} /> : null}
        </div>
      </Section>

      <Section title="Real Estate" href="/search?kind=property" icon={<HouseIcon className="size-5 text-primary" />}>
        <div className="grid gap-4">
          <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
            {propertyCategories.map((c, i) => (
              <Link
                key={c.id}
                to={`/search?category=${c.slug}`}
                className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${TILE_COLORS[(i + 3) % TILE_COLORS.length]}`}
              >
                <CategoryIcon name={c.icon} className="size-4" /> {c.name}
              </Link>
            ))}
          </div>
          {properties.length ? (
            <ProductShelf products={properties} />
          ) : (
            <p className="text-sm text-muted-foreground">No property listed yet. Merchants: list land, houses for sale or rentals from your dashboard.</p>
          )}
        </div>
      </Section>

      {sponsored.length ? (
        <Section title="Sponsored picks" icon={<SparklesIcon className="size-5 text-primary" />}>
          <ProductShelf products={sponsored} />
        </Section>
      ) : null}

      {deals.length ? (
        <Section title="Today's deals" href="/search?sort=featured">
          <ProductShelf products={deals} />
        </Section>
      ) : null}

      <section className="grid gap-4 rounded-3xl bg-secondary p-6 md:grid-cols-2 md:p-10">
        <div className="grid content-center gap-3">
          <h2 className="text-2xl font-black tracking-tight text-secondary-foreground md:text-3xl">
            Can't find it? Post a picture.
          </h2>
          <p className="text-secondary-foreground/80">
            Upload a photo of what you're after and merchants who can make or source it will message you directly.
          </p>
          <Button asChild variant="accent" className="w-fit">
            <Link to="/requests/new">
              <ImagePlusIcon /> Post a request
            </Link>
          </Button>
        </div>
        <div className="grid content-center gap-3 rounded-2xl bg-card p-6">
          <MegaphoneIcon className="size-8 text-primary" />
          <h3 className="text-lg font-bold">Selling? Get seen first.</h3>
          <p className="text-sm text-muted-foreground">
            Boost your products to the top of the storefront, or book a banner on the home page, search or the sides.
          </p>
          <Link to="/advertise" className="text-sm font-semibold text-primary hover:underline">
            Advertise on MyPlug →
          </Link>
        </div>
      </section>

      <Section title="Recommended for you" href="/search">
        {feed.length ? (
          <ProductGrid products={feed} />
        ) : (
          <p className="text-muted-foreground">No products yet — merchants, be the first to list something!</p>
        )}
      </Section>
    </Container>
  );
}
