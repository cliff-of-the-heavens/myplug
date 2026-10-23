import { HandCoinsIcon } from "lucide-react";
import { Form, Link } from "react-router";
import { Container, EmptyState, FormError, PageHeader } from "~/components/page";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { requireCustomer } from "~/lib/auth.server";
import { date, money } from "~/lib/format";
import { priceSuffix } from "~/lib/property";
import { myOffers, PropertyError, withdrawOffer } from "~/lib/property.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/account.offers";

export const meta: Route.MetaFunction = () => [{ title: "My property offers · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  return { offers: await myOffers(user.id) };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  try {
    await withdrawOffer(user.id, str((await request.formData()).get("offerId")));
    return { ok: "Offer withdrawn." };
  } catch (e) {
    if (e instanceof PropertyError) return { error: e.message };
    throw e;
  }
}

const STATUS: Record<string, { label: string; variant: "success" | "muted" | "highlight" }> = {
  pending: { label: "Waiting for the seller", variant: "highlight" },
  accepted: { label: "Accepted!", variant: "success" },
  declined: { label: "Declined", variant: "muted" },
  withdrawn: { label: "Withdrawn", variant: "muted" },
  lost: { label: "Went to someone else", variant: "muted" },
};

export default function MyOffers({ loaderData, actionData }: Route.ComponentProps) {
  const { offers } = loaderData;
  return (
    <Container className="grid max-w-3xl gap-4 py-8">
      <PageHeader title="My property offers" description="Offers and bids you've made on land, houses and rentals." />
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      {actionData && "ok" in actionData ? <p className="text-sm font-medium text-success">{actionData.ok}</p> : null}
      {!offers.length ? (
        <EmptyState icon={HandCoinsIcon} title="No offers yet">
          <Link to="/search?kind=property" className="font-semibold text-primary">
            Browse Real Estate
          </Link>
        </EmptyState>
      ) : (
        offers.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
            <SafeImage src={o.product.imageUrl} alt="" className="size-16 rounded-lg" />
            <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
              <Link to={`/p/${o.product.id}`} className="truncate font-semibold hover:underline">
                {o.product.title}
              </Link>
              <p className="text-muted-foreground">
                {o.product.store.name} · your {o.product.priceType === "reserve" ? "bid" : "offer"}:{" "}
                <strong className="text-foreground">
                  {money(o.amountCents, o.product.store.currency)}
                  {priceSuffix(o.product.listingType)}
                </strong>
              </p>
              {o.product.priceType === "reserve" && o.product.biddingEndsAt ? <p className="text-xs text-muted-foreground">Bidding ends {date(o.product.biddingEndsAt, true)}</p> : null}
              {o.status === "accepted" ? <p className="text-xs font-semibold text-success">Message the seller to arrange viewing, documents and payment. Never pay before checking the documents.</p> : null}
            </div>
            <Badge variant={STATUS[o.status].variant}>{STATUS[o.status].label}</Badge>
            {o.status === "pending" ? (
              <Form method="post">
                <input type="hidden" name="offerId" value={o.id} />
                <Button type="submit" size="sm" variant="ghost">
                  Withdraw
                </Button>
              </Form>
            ) : null}
          </div>
        ))
      )}
    </Container>
  );
}
