import { MinusIcon, PlusIcon, ShoppingCartIcon, Trash2Icon } from "lucide-react";
import { Link, useFetcher } from "react-router";
import { Container, EmptyState, PageHeader } from "~/components/page";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { requireCustomer } from "~/lib/auth.server";
import { money } from "~/lib/format";
import { getCart } from "~/lib/shopping.server";
import type { Route } from "./+types/cart";

export const meta: Route.MetaFunction = () => [{ title: "Cart · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  return { groups: await getCart(user.id) };
}

type Line = Route.ComponentProps["loaderData"]["groups"][number]["lines"][number];

function CartLine({ line, currency }: { line: Line; currency: string }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const set = (quantity: number) => fetcher.submit({ intent: "set", productId: line.productId, quantity: String(quantity) }, { method: "post", action: "/api/cart" });
  return (
    <li className={busy ? "opacity-60" : undefined}>
      <div className="flex flex-wrap items-center gap-3 py-3">
        <SafeImage src={line.imageUrl} hidden={line.imageHidden} alt="" className="size-16 shrink-0 rounded-lg" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <Link to={`/p/${line.productId}`} className="truncate font-semibold hover:text-primary">{line.title}</Link>
          <p className="text-sm">
            {money(line.unitCents, currency)}
            {line.salePct ? (
              <>
                {" "}
                <span className="text-xs text-muted-foreground line-through">{money(line.priceCents, currency)}</span>{" "}
                <Badge variant="highlight">-{line.salePct}%</Badge>
              </>
            ) : null}
          </p>
          {line.problem ? <p className="text-xs font-semibold text-destructive">{line.problem}</p> : null}
        </div>
        <div className="flex items-center rounded-full border-2">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Less" disabled={busy} onClick={() => set(line.quantity - 1)}>
            <MinusIcon />
          </Button>
          <span className="w-8 text-center font-bold">{line.quantity}</span>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="More" disabled={busy} onClick={() => set(line.quantity + 1)}>
            <PlusIcon />
          </Button>
        </div>
        <span className="w-24 text-right font-bold">{money(line.lineCents, currency)}</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" disabled={busy} onClick={() => fetcher.submit({ intent: "remove", productId: line.productId }, { method: "post", action: "/api/cart" })}>
          <Trash2Icon />
        </Button>
      </div>
    </li>
  );
}

export default function Cart({ loaderData }: Route.ComponentProps) {
  const { groups } = loaderData;
  return (
    <Container className="max-w-4xl py-8">
      <PageHeader title="Your cart" description={groups.length > 1 ? "Each store is checked out separately: they deliver and get paid separately." : undefined} />
      {groups.length === 0 ? (
        <EmptyState icon={ShoppingCartIcon} title="Your cart is empty">
          <Link to="/search" className="font-semibold text-primary">Start shopping</Link>
        </EmptyState>
      ) : (
        <div className="grid gap-6">
          {groups.map((g) => {
            const blocked = g.lines.every((l) => l.problem);
            return (
              <Card key={g.storeId}>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>
                    <Link to={`/s/${g.storeSlug}`} className="hover:text-primary">{g.storeName}</Link>
                  </CardTitle>
                  <span className="text-sm text-muted-foreground">{g.lines.length} item{g.lines.length === 1 ? "" : "s"}</span>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <ul className="divide-y">
                    {g.lines.map((l) => (
                      <CartLine key={l.productId} line={l} currency={g.currency} />
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-3">
                    <span className="text-sm text-muted-foreground">Subtotal</span>
                    <span className="text-xl font-black">{money(g.subtotalCents, g.currency)}</span>
                    {blocked ? (
                      <Button disabled>Nothing available to buy</Button>
                    ) : (
                      <Button asChild size="lg">
                        <Link to={`/cart/checkout/${g.storeId}`}>Checkout {g.storeName}</Link>
                      </Button>
                    )}
                  </div>
                  <p className="text-right text-xs text-muted-foreground">Promo codes and gift coupons are applied at checkout.</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </Container>
  );
}
