import { GiftIcon, MapPinIcon, ShoppingBagIcon } from "lucide-react";
import { data, Link } from "react-router";
import { Container } from "~/components/page";
import { ShareButton } from "~/components/share-button";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { getUser } from "~/lib/auth.server";
import { couponState, findCoupon } from "~/lib/coupons.server";
import { date, money } from "~/lib/format";
import type { Route } from "./+types/gift";

// The code in the address is what gives the coupon its value: keep the page out of
// search engines and don't pass the address on to other sites.
export const meta: Route.MetaFunction = () => [
  { title: "Gift coupon · MyPlug" },
  { name: "robots", content: "noindex, nofollow" },
  { name: "referrer", content: "no-referrer" },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const [c, user] = await Promise.all([findCoupon(params.code), getUser(request)]);
  if (!c) throw data("We couldn't find that gift coupon. Check the code.", { status: 404 });
  const state = couponState(c);
  return {
    coupon: {
      code: c.code,
      state,
      initialCents: c.initialCents,
      balanceCents: c.balanceCents,
      currency: c.currency,
      recipientName: c.recipientName,
      message: c.message,
      expiresAt: c.expiresAt,
      store: c.store,
      history: c.redemptions.map((r) => ({ id: r.id, amountCents: r.amountCents, channel: r.channel, at: r.createdAt })),
    },
    isBuyer: !!user && user.id === c.purchaserId,
  };
}

const STATE = {
  pending: { label: "Waiting for payment", tone: "warning" },
  active: { label: "Ready to use", tone: "success" },
  used: { label: "Fully used", tone: "muted" },
  expired: { label: "Expired", tone: "muted" },
  void: { label: "Cancelled", tone: "destructive" },
} as const;

export default function Gift({ loaderData }: Route.ComponentProps) {
  const { coupon: c, isBuyer } = loaderData;
  const s = STATE[c.state];
  return (
    <Container className="grid max-w-lg gap-4 py-8">
      <Card className="overflow-hidden">
        <div className="brand-gradient grid gap-1 p-6 text-white">
          <p className="flex items-center gap-2 text-sm font-semibold opacity-90"><GiftIcon className="size-5" /> Gift coupon</p>
          <p className="text-2xl font-black">{c.store.name}</p>
          <p className="text-4xl font-black">{money(c.balanceCents, c.currency)}</p>
          {c.balanceCents !== c.initialCents ? <p className="text-sm opacity-90">of {money(c.initialCents, c.currency)}</p> : null}
        </div>
        <CardContent className="grid gap-4 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={s.tone}>{s.label}</Badge>
            {c.expiresAt ? <span className="text-sm text-muted-foreground">valid until {date(c.expiresAt)}</span> : null}
          </div>
          {c.recipientName || c.message ? (
            <div className="rounded-xl bg-secondary/60 p-3 text-sm">
              {c.recipientName ? <p className="font-semibold">For {c.recipientName}</p> : null}
              {c.message ? <p className="whitespace-pre-line">“{c.message}”</p> : null}
            </div>
          ) : null}
          {c.state !== "pending" ? (
            <div className="grid gap-1 text-center">
              <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Coupon code</p>
              <p className="font-mono text-2xl font-black tracking-wider break-all">{c.code}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">The code appears here once {c.store.name} confirms the payment.</p>
          )}
          {c.state === "active" ? (
            <div className="grid gap-2 text-sm">
              <p className="flex gap-2"><ShoppingBagIcon className="size-4 shrink-0 text-primary" /> <span><strong>Online:</strong> add items from {c.store.name} to your cart and enter the code at checkout.</span></p>
              <p className="flex gap-2"><MapPinIcon className="size-4 shrink-0 text-primary" /> <span><strong>At the shop:</strong> show this page or read out the code{c.store.pickupAddress ? ` at ${c.store.pickupAddress}` : ""}.</span></p>
              <p className="text-xs text-muted-foreground">Whatever you don't spend stays on the coupon for next time. Anyone with the code can use it, so keep it private.</p>
              <Button asChild>
                <Link to={`/s/${c.store.slug}`}>Shop at {c.store.name}</Link>
              </Button>
            </div>
          ) : null}
          {isBuyer && c.state === "active" ? (
            <ShareButton
              path={`/gift/${c.code}`}
              title={`A ${c.store.name} gift coupon for you`}
              text={`${c.recipientName ? `${c.recipientName}, here's` : "Here's"} a ${money(c.balanceCents, c.currency)} gift coupon for ${c.store.name}!`}
              label="Send it to someone"
              variant="default"
            />
          ) : null}
          {c.history.length ? (
            <div className="grid gap-1 border-t pt-3 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">History</p>
              {c.history.map((h) => (
                <p key={h.id}>
                  {date(h.at, true)} · {h.amountCents < 0 ? `refunded ${money(-h.amountCents, c.currency)}` : `used ${money(h.amountCents, c.currency)} ${h.channel === "in_store" ? "at the shop" : "online"}`}
                </p>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Container>
  );
}
