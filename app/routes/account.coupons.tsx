import { GiftIcon } from "lucide-react";
import { Link } from "react-router";
import { Container, EmptyState, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { requireCustomer } from "~/lib/auth.server";
import { couponState, myCoupons } from "~/lib/coupons.server";
import { date, money } from "~/lib/format";
import type { Route } from "./+types/account.coupons";

export const meta: Route.MetaFunction = () => [{ title: "Gift coupons · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  const list = await myCoupons(user.id);
  return { coupons: list.map((c) => ({ ...c, state: couponState(c) })) };
}

const TONE = { pending: "warning", active: "success", used: "muted", expired: "muted", void: "destructive" } as const;
const LABEL = { pending: "Waiting for payment", active: "Ready", used: "Used", expired: "Expired", void: "Cancelled" } as const;

export default function MyCoupons({ loaderData }: Route.ComponentProps) {
  const { coupons } = loaderData;
  return (
    <Container className="max-w-3xl py-8">
      <PageHeader title="Gift coupons" description="Coupons you've bought. Open one to see its code and send it to someone." />
      {coupons.length === 0 ? (
        <EmptyState icon={GiftIcon} title="No gift coupons yet">
          Stores that sell coupons show a <strong>Gift coupon</strong> button on their page.
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {coupons.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex flex-wrap items-center gap-3 pt-5 text-sm">
                <GiftIcon className="size-6 text-primary" />
                <div className="grid flex-1 gap-0.5">
                  <Link to={`/gift/${c.code}`} className="font-bold hover:text-primary">{c.store.name}</Link>
                  <p className="text-muted-foreground">
                    {money(c.balanceCents, c.currency)} of {money(c.initialCents, c.currency)}
                    {c.recipientName ? ` · for ${c.recipientName}` : ""}
                    {c.expiresAt ? ` · until ${date(c.expiresAt)}` : ""}
                  </p>
                </div>
                <Badge variant={TONE[c.state]}>{LABEL[c.state]}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </Container>
  );
}
