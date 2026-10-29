import { BadgeCheckIcon, CalendarCheckIcon, DownloadIcon, GavelIcon, HouseIcon, SparklesIcon } from "lucide-react";
import { Link } from "react-router";
import type { ProductCardData } from "~/lib/catalog.server";
import { money, stockLabel } from "~/lib/format";
import { LISTING_BADGE, priceSuffix, soldWord } from "~/lib/property";
import { autoSummary } from "~/lib/auto";
import { conditionInfo } from "~/lib/condition";
import { cn } from "~/lib/utils";
import { DealCountdown, priceDisplay } from "./price";
import { VoteBadge } from "./handyman-votes";
import { RatingBadge } from "./rating";
import { SafeImage } from "./safe-image";
import { FavouriteButton } from "./shopping";
import { Badge } from "./ui/badge";

export function ProductCard({ product, className }: { product: ProductCardData; className?: string }) {
  const isService = product.kind === "service";
  const stock = stockLabel(product.quantity, product.trackStock); // services never track stock
  const price = priceDisplay(product);
  const discount = price.pct;

  return (
    <Link
      to={`/p/${product.id}`}
      prefetch="intent"
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10",
        className,
      )}
    >
      <div className="relative">
        <SafeImage
          src={product.imageUrl}
          alt={product.title}
          className="aspect-square"
          imgClassName={cn("transition-transform duration-300 group-hover:scale-105", stock.tone === "out" && "grayscale")}
        />
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          {product.promoTier ? (
            <Badge variant="sponsored">
              <SparklesIcon /> {product.promoTier === "boost" ? "Sponsored" : product.promoTier}
            </Badge>
          ) : null}
          {discount > 0 ? <Badge variant="highlight">-{discount}%</Badge> : null}
          {isService ? (
            <Badge variant="accent">
              <CalendarCheckIcon /> Bookable
            </Badge>
          ) : product.kind === "digital" ? (
            <Badge variant="accent">
              <DownloadIcon /> Digital
            </Badge>
          ) : product.kind === "property" && product.listingType ? (
            <Badge variant="accent">
              <HouseIcon /> {LISTING_BADGE[product.listingType]}
            </Badge>
          ) : null}
          {product.priceType === "reserve" && !product.soldAt ? (
            <Badge variant="highlight">
              <GavelIcon /> Bidding
            </Badge>
          ) : null}
        </div>
        <div className="absolute top-2 right-2 flex flex-col items-center gap-1.5">
          <FavouriteButton productId={product.id} />
          {product.storeVerified ? <VerifiedTick /> : null}
        </div>
        {product.soldAt ? (
          <span className="absolute inset-x-0 bottom-0 bg-destructive py-1 text-center text-xs font-bold tracking-wide text-white uppercase">
            {soldWord(product.listingType)}
          </span>
        ) : stock.tone === "out" ? (
          <span className="absolute inset-x-0 bottom-0 bg-foreground/75 py-1 text-center text-xs font-semibold text-background">
            Out of stock
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary">{product.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {product.storeName}
          <RatingBadge average={product.ratingAvg} total={product.ratingCount} />
          {product.isTradesperson ? <VoteBadge summary={{ up: product.votesUp ?? 0, down: product.votesDown ?? 0 }} /> : null}
        </p>
        {product.autoDetails ? <p className="truncate text-xs text-muted-foreground">{autoSummary(product.autoDetails)}</p> : null}
        {product.condition ? <p className="truncate text-xs font-medium text-muted-foreground">{conditionInfo(product.condition).label}</p> : null}
        {product.kind === "property" && product.propertyFeatures ? (
          <p className="truncate text-xs text-muted-foreground">
            {[
              product.propertyFeatures.bedrooms != null ? `${product.propertyFeatures.bedrooms} bed` : null,
              product.propertyFeatures.bathrooms != null ? `${product.propertyFeatures.bathrooms} bath` : null,
              product.propertyFeatures.plotSize,
              product.propertyFeatures.location,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        <div className="mt-auto flex items-baseline gap-2 pt-1">
          {product.kind === "service" || product.kind === "digital" || product.priceType === "reserve" ? (
            <span className="text-xs text-muted-foreground">from</span>
          ) : null}
          <span className="text-lg font-extrabold">{money(price.now, product.currency)}</span>
          {product.kind === "property" ? <span className="text-xs text-muted-foreground">{priceSuffix(product.listingType)}</span> : null}
          {price.was ? <span className="text-xs text-muted-foreground line-through">{money(price.was, product.currency)}</span> : null}
        </div>
        {product.salePct && product.saleEndsAt ? <DealCountdown endsAt={product.saleEndsAt} /> : null}
        {stock.tone === "low" ? <p className="text-xs font-semibold text-destructive">{stock.text}</p> : null}
      </div>
    </Link>
  );
}

export function ProductGrid({ products }: { products: ProductCardData[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}

/** Horizontally scrolling row, like the shelves on Amazon/Takealot. */
export function ProductShelf({ products }: { products: ProductCardData[] }) {
  return (
    <div className="scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:gap-4">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} className="w-40 shrink-0 snap-start sm:w-48" />
      ))}
    </div>
  );
}

/** Green tick in a card's corner: the seller is a Verified merchant. */
export function VerifiedTick({ className }: { className?: string }) {
  return (
    <span
      title="Verified merchant: MyPlug checked their registration, address and contacts"
      aria-label="Verified merchant"
      role="img"
      className={cn("flex size-8 items-center justify-center rounded-full bg-success text-white shadow-md ring-2 ring-white", className)}
    >
      <BadgeCheckIcon className="size-5" />
    </span>
  );
}
