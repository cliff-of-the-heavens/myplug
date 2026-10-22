import { eq } from "drizzle-orm";
import { GiftIcon } from "lucide-react";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import { AuthLink } from "~/components/auth-dialog";
import { Container, FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Field, Input, Textarea } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { getUser, requireCustomer } from "~/lib/auth.server";
import { buyCoupon, CouponError } from "~/lib/coupons.server";
import { currencySymbol, money, parseMoney } from "~/lib/format";
import { useOptionalUser } from "~/lib/hooks";
import { notify } from "~/lib/notify.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/store.gift";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `Gift coupon · ${data.store.name} · MyPlug` : "Gift coupon · MyPlug" }];
}

async function loadStore(slug: string) {
  const store = await db.query.stores.findFirst({
    where: eq(schema.stores.slug, slug),
    columns: { id: true, ownerId: true, name: true, slug: true, logoUrl: true, status: true, currency: true, couponsEnabled: true, couponMinCents: true, couponMaxCents: true, couponValidityDays: true },
  });
  if (!store || store.status !== "approved" || !store.couponsEnabled) throw data("This store doesn't sell gift coupons.", { status: 404 });
  return store;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await getUser(request);
  const { ownerId: _, ...store } = await loadStore(params.slug);
  return { store };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const store = await loadStore(params.slug);
  const form = await request.formData();
  try {
    const { order } = await buyCoupon({
      customerId: user.id,
      storeId: store.id,
      amountCents: parseMoney(form.get("amount")) ?? 0,
      recipientName: str(form.get("recipientName")),
      message: str(form.get("message")),
    });
    await notify([store.ownerId], { title: `Gift coupon ordered: ${order.number}`, body: money(order.totalCents, order.currency), href: `/sell/orders/${order.id}` }, { email: true });
    return redirect(`/account/orders/${order.id}?placed=1`);
  } catch (e) {
    if (e instanceof CouponError) return { error: e.message };
    throw e;
  }
}

export default function BuyGift({ loaderData, actionData }: Route.ComponentProps) {
  const { store } = loaderData;
  const user = useOptionalUser();
  const busy = useNavigation().state !== "idle";
  const sym = currencySymbol(store.currency);
  const suggestions = [5_000_00, 10_000_00, 25_000_00, 50_000_00].filter(
    (a) => (!store.couponMinCents || a >= store.couponMinCents) && (!store.couponMaxCents || a <= store.couponMaxCents),
  );

  return (
    <Container className="max-w-xl py-8">
      <PageHeader title={`${store.name} gift coupon`} description="Buy a coupon and send it to anyone. They can spend it online here or at the shop." />
      <Card>
        <CardContent className="pt-5">
          {user?.role === "customer" ? (
            <Form method="post" className="grid gap-4">
              <FormError error={actionData?.error} />
              <Field
                label={`Amount (${sym})`}
                hint={[store.couponMinCents && `from ${money(store.couponMinCents, store.currency)}`, store.couponMaxCents && `up to ${money(store.couponMaxCents, store.currency)}`].filter(Boolean).join(" ") || undefined}
              >
                <Input name="amount" inputMode="decimal" required list="gift-amounts" placeholder="e.g. 25,000" />
                <datalist id="gift-amounts">
                  {suggestions.map((a) => <option key={a} value={a / 100} />)}
                </datalist>
              </Field>
              <Field label="Who is it for? (optional)">
                <Input name="recipientName" maxLength={80} placeholder="e.g. Chisomo" />
              </Field>
              <Field label="Message (optional)">
                <Textarea name="message" rows={2} maxLength={300} className="min-h-0" placeholder="Happy birthday!" />
              </Field>
              <Button type="submit" size="lg" disabled={busy}><GiftIcon /> Buy gift coupon</Button>
              <p className="text-xs text-muted-foreground">
                You pay {store.name} first. Once they confirm your payment, you get the coupon code and a link to share.
                Valid for {Math.round(store.couponValidityDays / 30)} months. Anyone with the code can spend it, so share it only
                with the person it's for.
              </p>
            </Form>
          ) : user ? (
            <p className="text-sm text-muted-foreground">Gift coupons are bought with a customer account.</p>
          ) : (
            <Button asChild size="lg"><AuthLink mode="login">Sign in to buy a coupon</AuthLink></Button>
          )}
        </CardContent>
      </Card>
      <p className="mt-4 text-sm">
        <Link to={`/s/${store.slug}`} className="font-semibold text-primary">Back to {store.name}</Link>
      </p>
    </Container>
  );
}
