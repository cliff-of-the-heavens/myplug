import { HeartIcon, MinusIcon, PlusIcon, ShoppingCartIcon, ZapIcon } from "lucide-react";
import { useState } from "react";
import { Link, useFetcher, useRouteLoaderData } from "react-router";
import { useOptionalUser } from "~/lib/hooks";
import { cn } from "~/lib/utils";
import type { loader as rootLoader } from "~/root";
import { AuthLink } from "./auth-dialog";
import { Button } from "./ui/button";

/** Heart to save a product or store. Guests are asked to sign in. */
export function FavouriteButton({
  productId,
  storeId,
  label,
  className,
}: {
  productId?: string;
  storeId?: string;
  label?: string;
  className?: string;
}) {
  const user = useOptionalUser();
  const saved = useRouteLoaderData<typeof rootLoader>("root")?.saved;
  const fetcher = useFetcher();
  const isSaved = productId ? !!saved?.products.includes(productId) : !!saved?.stores.includes(storeId!);
  // Show the new state straight away while the request is on its way.
  const shown = fetcher.state !== "idle" ? !isSaved : isSaved;
  const cls = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-colors",
    label ? "border-2 px-3 py-1.5 hover:border-primary/50" : "size-8 bg-background/90 shadow-sm hover:bg-background",
    className,
  );
  const icon = <HeartIcon className={cn("size-4", shown ? "fill-primary text-primary" : "text-muted-foreground")} />;
  const text = label ? (shown ? "Saved" : label) : null;

  if (!user) {
    return (
      <AuthLink mode="login" className={cls} aria-label="Save" onClick={(e) => e.stopPropagation()}>
        {icon} {text}
      </AuthLink>
    );
  }
  if (user.role !== "customer") return null;
  return (
    <button
      type="button"
      aria-pressed={shown}
      aria-label={shown ? "Remove from favourites" : "Save to favourites"}
      className={cls}
      onClick={(e) => {
        e.preventDefault(); // cards are links; don't open the product
        e.stopPropagation();
        fetcher.submit(productId ? { productId } : { storeId: storeId! }, { method: "post", action: "/api/favourite" });
      }}
    >
      {icon} {text}
    </button>
  );
}

/** Quantity, "Add to cart" and "Buy now" for a product page. */
export function CartButtons({ productId, storeId, max }: { productId: string; storeId: string; max: number }) {
  const [qty, setQty] = useState(1);
  const fetcher = useFetcher<{ ok?: string; error?: string }>();
  const busy = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" action="/api/cart" className="grid gap-3">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="storeId" value={storeId} />
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold">Quantity</span>
        <div className="flex items-center rounded-full border-2">
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less">
            <MinusIcon />
          </Button>
          <input
            name="quantity"
            type="number"
            min={1}
            max={max}
            value={qty}
            onChange={(e) => setQty(Math.min(max, Math.max(1, Number(e.target.value) || 1)))}
            className="w-12 bg-transparent text-center font-bold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setQty((q) => Math.min(max, q + 1))} aria-label="More">
            <PlusIcon />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="submit" name="intent" value="add" variant="outline" size="lg" disabled={busy}>
          <ShoppingCartIcon /> Add to cart
        </Button>
        <Button type="submit" name="intent" value="buy" size="lg" disabled={busy}>
          <ZapIcon /> Buy now
        </Button>
      </div>
      {fetcher.data?.ok ? (
        <p className="text-sm font-medium text-success">
          {fetcher.data.ok} <Link to="/cart" className="underline">View cart</Link>
        </p>
      ) : null}
      {fetcher.data?.error ? <p className="text-sm font-medium text-destructive">{fetcher.data.error}</p> : null}
    </fetcher.Form>
  );
}
