import { CalendarCheckIcon, DownloadIcon, SparklesIcon } from "lucide-react";
import { Link } from "react-router";
import type { ProductCardData } from "~/lib/catalog.server";
import { money, stockLabel } from "~/lib/format";
import { cn } from "~/lib/utils";
import { SafeImage } from "./safe-image";
import { Badge } from "./ui/badge";

export function ProductCard({ product, className }: { product: ProductCardData; className?: string }) {
  const isService = product.kind === "service";
  const stock = stockLabel(product.quantity, product.trackStock); // services never track stock
  const discount =
    product.compareAtCents && product.compareAtCents > product.priceCents
      ? Math.round((1 - product.priceCents / product.compareAtCents) * 100)
      : 0;

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
          ) : null}
        </div>
        {stock.tone === "out" ? (
          <span className="absolute inset-x-0 bottom-0 bg-foreground/75 py-1 text-center text-xs font-semibold text-background">
            Out of stock
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary">{product.title}</p>
        <p className="text-xs text-muted-foreground">{product.storeName}</p>
        <div className="mt-auto flex items-baseline gap-2 pt-1">
          {product.kind !== "product" ? <span className="text-xs text-muted-foreground">from</span> : null}
          <span className="text-lg font-extrabold">{money(product.priceCents, product.currency)}</span>
          {discount > 0 ? (
            <span className="text-xs text-muted-foreground line-through">{money(product.compareAtCents!, product.currency)}</span>
          ) : null}
        </div>
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
