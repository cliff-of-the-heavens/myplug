import { GavelIcon, HandCoinsIcon, MessageCircleIcon } from "lucide-react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { EmptyState, FormError, PageHeader } from "~/components/page";
import { DealCountdown } from "~/components/price";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { requireMerchant } from "~/lib/auth.server";
import { date, money, timeAgo } from "~/lib/format";
import { findOrCreateConversation } from "~/lib/messaging.server";
import { LISTING_BADGE, PRICE_TYPE_LABEL, priceSuffix, soldWord } from "~/lib/property";
import { decideOffer, markSoldElsewhere, PropertyError, storeOffers } from "~/lib/property.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/sell.offers";

export const meta: Route.MetaFunction = () => [{ title: "Property offers · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  return { listings: await storeOffers(user.storeId!), currency: user.storeCurrency ?? "MWK" };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireMerchant(request);
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    if (intent === "accept" || intent === "decline") {
      await decideOffer(user.id, str(form.get("offerId")), intent === "accept");
      return { ok: intent === "accept" ? "Offer accepted. The buyer and the other bidders have been told. The listing is archived tomorrow." : "Offer declined. The buyer has been told." };
    }
    if (intent === "sold-elsewhere") {
      await markSoldElsewhere(user.id, str(form.get("productId")));
      return { ok: "Marked as no longer available. Anyone with an open offer has been told." };
    }
    if (intent === "message") {
      const listings = await storeOffers(user.storeId!);
      const listing = listings.find((l) => l.propertyOffers.some((o) => o.customerId === str(form.get("customerId"))));
      if (!listing) return { error: "Buyer not found." };
      const c = await findOrCreateConversation({ customerId: str(form.get("customerId")), storeId: user.storeId!, subject: listing.title, productId: listing.id });
      throw redirect(`/messages/${c.id}`);
    }
  } catch (e) {
    if (e instanceof PropertyError) return { error: e.message };
    throw e;
  }
  return { error: "Unknown action." };
}

const STATUS: Record<string, { label: string; variant: "success" | "muted" | "highlight" | "destructive" }> = {
  pending: { label: "Open", variant: "highlight" },
  accepted: { label: "Accepted", variant: "success" },
  declined: { label: "Declined", variant: "muted" },
  withdrawn: { label: "Withdrawn", variant: "muted" },
  lost: { label: "Not chosen", variant: "muted" },
};

export default function SellOffers({ loaderData, actionData }: Route.ComponentProps) {
  const { listings, currency } = loaderData;
  const busy = useNavigation().state !== "idle";
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Property offers"
        description="Offers and bids on your land, houses and rentals. Choose who gets the property: it's then marked sold (or let) and archived the next day."
        actions={
          <Button asChild variant="outline">
            <Link to="/sell/products/new?kind=property">List a property</Link>
          </Button>
        }
      />
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      {actionData && "ok" in actionData ? <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}

      {!listings.length ? (
        <EmptyState icon={HandCoinsIcon} title="No property listings yet">
          List land, a house for sale or a rental, and offers from customers appear here.
        </EmptyState>
      ) : (
        listings.map((l) => {
          const bidding = l.priceType === "reserve";
          const open = bidding && l.biddingEndsAt && new Date(l.biddingEndsAt) > new Date();
          const live = l.propertyOffers.filter((o) => o.status === "pending");
          return (
            <Card key={l.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <Link to={`/p/${l.id}`} className="hover:underline">
                    {l.title}
                  </Link>
                  {l.listingType ? <Badge variant="accent">{LISTING_BADGE[l.listingType]}</Badge> : null}
                  {l.soldAt ? <Badge variant="destructive">{soldWord(l.listingType)} {date(l.soldAt)}</Badge> : null}
                </CardTitle>
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {money(l.priceCents, currency)}
                  {priceSuffix(l.listingType)} · {l.priceType ? PRICE_TYPE_LABEL[l.priceType] : ""}
                  {bidding && l.reservePriceCents ? <> · reserve {money(l.reservePriceCents, currency)} (only you see this)</> : null}
                </p>
                {bidding && l.biddingEndsAt ? (
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <GavelIcon className="size-4" />
                    {open ? (
                      <>
                        Bidding ends {date(l.biddingEndsAt, true)} <DealCountdown endsAt={l.biddingEndsAt} />. You can choose a buyer once it closes.
                      </>
                    ) : (
                      <>Bidding closed {date(l.biddingEndsAt, true)}{!l.soldAt ? ": choose a buyer." : "."}</>
                    )}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="grid gap-2">
                {l.propertyOffers.length ? (
                  l.propertyOffers.map((o, n) => (
                    <div key={o.id} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="grid gap-0.5 text-sm">
                        <p className="flex flex-wrap items-center gap-2">
                          <strong className="text-base">{money(o.amountCents, currency)}</strong>
                          {priceSuffix(l.listingType)}
                          <span>from {o.customerName}</span>
                          <Badge variant={STATUS[o.status].variant}>{STATUS[o.status].label}</Badge>
                          {n === 0 && o.status === "pending" && live.length > 1 ? <Badge variant="success">Highest</Badge> : null}
                          {bidding && l.reservePriceCents && o.amountCents < l.reservePriceCents && o.status === "pending" ? <span className="text-xs text-destructive">below reserve</span> : null}
                        </p>
                        {o.message ? <p className="text-muted-foreground">"{o.message}"</p> : null}
                        <p className="text-xs text-muted-foreground">{timeAgo(o.updatedAt)}</p>
                      </div>
                      <Form method="post" className="flex flex-wrap gap-2">
                        <input type="hidden" name="offerId" value={o.id} />
                        <input type="hidden" name="customerId" value={o.customerId} />
                        <Button type="submit" name="intent" value="message" size="sm" variant="ghost">
                          <MessageCircleIcon /> Message
                        </Button>
                        {o.status === "pending" && !l.soldAt ? (
                          <>
                            <Button type="submit" name="intent" value="decline" size="sm" variant="outline" disabled={busy}>
                              Decline
                            </Button>
                            <Button type="submit" name="intent" value="accept" size="sm" disabled={busy || !!open} title={open ? "Wait until bidding closes" : undefined}>
                              Accept: {l.listingType === "rental" ? "let" : "sell"} to {o.customerName}
                            </Button>
                          </>
                        ) : null}
                      </Form>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No offers yet.</p>
                )}
                {!l.soldAt ? (
                  <Form method="post" className="justify-self-end">
                    <input type="hidden" name="productId" value={l.id} />
                    <Button type="submit" name="intent" value="sold-elsewhere" size="sm" variant="ghost" disabled={busy}>
                      {soldWord(l.listingType)} elsewhere: take it off the market
                    </Button>
                  </Form>
                ) : null}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
