import { eq } from "drizzle-orm";
import { GiftIcon, TagIcon } from "lucide-react";
import { useState } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import { DeliveryFields } from "~/components/delivery-fields";
import { Container, FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input, Textarea } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { listAddresses } from "~/lib/addresses.server";
import { requireCustomer } from "~/lib/auth.server";
import { couponState, findCoupon } from "~/lib/coupons.server";
import { availableCouriers, createDeliveryTx, deliveryFromForm, notifyInvitedCouriers, usualCouriers } from "~/lib/delivery.server";
import { money } from "~/lib/format";
import { notify } from "~/lib/notify.server";
import { BILL_TERMS_DAYS } from "~/lib/orders";
import { OrderError, placeOrder } from "~/lib/orders.server";
import { applyPromoCode, PromoError } from "~/lib/pricing.server";
import { getCart, removeFromCart } from "~/lib/shopping.server";
import { cn, isUuid, str } from "~/lib/utils";
import type { Route } from "./+types/cart.checkout";

export const meta: Route.MetaFunction = () => [{ title: "Checkout · MyPlug" }];

async function loadCheckout(userId: string, storeId: string) {
  if (!isUuid(storeId)) throw data("Not found", { status: 404 });
  const group = (await getCart(userId)).find((g) => g.storeId === storeId);
  if (!group) throw redirect("/cart");
  const lines = group.lines.filter((l) => !l.problem);
  if (!lines.length) throw redirect("/cart");
  const store = await db.query.stores.findFirst({
    where: eq(schema.stores.id, storeId),
    columns: { id: true, ownerId: true, name: true, currency: true, deliveryMode: true, preferredCourierId: true },
    with: { preferredCourier: { columns: { name: true } } },
  });
  return { group: { ...group, lines }, store: store! };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  const { group, store } = await loadCheckout(user.id, params.storeId);
  const custom = store.deliveryMode === "customer";
  const [addresses, couriers, usual] = await Promise.all([
    listAddresses(user.id),
    custom ? availableCouriers() : [],
    custom ? usualCouriers(user.id) : [],
  ]);
  const { ownerId: _, ...publicStore } = store;
  return { group, store: publicStore, addresses, couriers, usualCourierIds: usual };
}

/** Works out the promo discount and coupon payment without placing the order (the "Apply" buttons). */
async function quote(userId: string, storeId: string, lines: { productId: string; lineCents: number }[], promoCode: string, couponCode: string) {
  const subtotal = lines.reduce((s, l) => s + l.lineCents, 0);
  let discount = 0;
  let promoError: string | null = null;
  if (promoCode) {
    try {
      discount = (await applyPromoCode(db, { storeId, code: promoCode, customerId: userId, lines: lines.map((l) => ({ productId: l.productId, totalCents: l.lineCents })) })).discountCents;
    } catch (e) {
      if (!(e instanceof PromoError)) throw e;
      promoError = e.message;
    }
  }
  let couponUsed = 0;
  let couponError: string | null = null;
  if (couponCode) {
    const c = await findCoupon(couponCode);
    const state = c ? couponState(c) : null;
    if (!c || c.storeId !== storeId) couponError = "That gift coupon can't be used at this store.";
    else if (state !== "active") couponError = state === "pending" ? "That coupon hasn't been paid for yet." : state === "expired" ? "That coupon has expired." : "That coupon has no balance left.";
    else couponUsed = Math.min(c.balanceCents, subtotal - discount);
  }
  return { subtotal, discount, couponUsed, toPay: subtotal - discount - couponUsed, promoError, couponError };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const { group, store } = await loadCheckout(user.id, params.storeId);
  const form = await request.formData();
  const promoCode = str(form.get("promoCode")).slice(0, 40);
  const couponCode = str(form.get("couponCode")).slice(0, 40);

  if (form.get("intent") === "quote") {
    return { quote: await quote(user.id, store.id, group.lines, promoCode, couponCode) };
  }

  try {
    const delivery = await deliveryFromForm(form, user.id, store.deliveryMode, store.preferredCourierId);
    const order = await placeOrder({
      customerId: user.id,
      items: group.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      shippingAddress: delivery.shippingAddress,
      notes: str(form.get("notes")),
      paymentTiming: form.get("payment") === "prepaid" ? "prepaid" : "on_delivery",
      promoCode: promoCode || undefined,
      couponCode: couponCode || undefined,
      createDelivery: (tx, orderId) => createDeliveryTx(tx, orderId, delivery),
    });
    await removeFromCart(user.id, group.lines.map((l) => l.productId));
    await notifyInvitedCouriers(order.id);
    await notify([store.ownerId], {
      title: `New order ${order.number}`,
      body: `${group.lines.length} item${group.lines.length === 1 ? "" : "s"} · ${money(order.totalCents, order.currency)}`,
      href: `/sell/orders/${order.id}`,
    }, { email: true });
    return redirect(`/account/orders/${order.id}?placed=1`);
  } catch (e) {
    if (e instanceof OrderError) return { error: e.message };
    throw e;
  }
}

export default function Checkout({ loaderData, actionData }: Route.ComponentProps) {
  const { group, store, addresses, couriers, usualCourierIds } = loaderData;
  const nav = useNavigation();
  const busy = nav.state !== "idle" && nav.formData?.get("intent") !== "quote";
  const q = actionData && "quote" in actionData ? actionData.quote : null;
  const [payment, setPayment] = useState<"on_delivery" | "prepaid">("on_delivery");

  return (
    <Container className="max-w-5xl py-8">
      <PageHeader
        title={`Checkout: ${store.name}`}
        actions={
          <Button asChild variant="outline">
            <Link to="/cart">Back to cart</Link>
          </Button>
        }
      />
      <Form method="post" encType="multipart/form-data" className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Delivery</CardTitle>
            </CardHeader>
            <CardContent>
              <DeliveryFields
                addresses={addresses}
                mode={store.deliveryMode}
                storeName={store.name}
                storeCourierName={store.preferredCourier?.name ?? null}
                couriers={couriers}
                usualCourierIds={usualCourierIds}
                currency={store.currency}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["on_delivery", "Pay after delivery", `Bill due ${BILL_TERMS_DAYS} days after it arrives`],
                    ["prepaid", "Pay in advance", "The store dispatches once your payment is confirmed"],
                  ] as const
                ).map(([v, label, text]) => (
                  <label key={v} className={cn("flex cursor-pointer gap-2 rounded-xl border-2 p-3 text-sm", payment === v ? "border-primary bg-primary/5" : "hover:border-primary/40")}>
                    <input type="radio" name="payment" value={v} checked={payment === v} onChange={() => setPayment(v)} className="mt-0.5 accent-primary" />
                    <span className="grid">
                      <span className="font-semibold">{label}</span>
                      <span className="text-xs text-muted-foreground">{text}</span>
                    </span>
                  </label>
                ))}
              </div>
              <Field label="Notes for the store (optional)">
                <Textarea name="notes" rows={2} className="min-h-0" />
              </Field>
            </CardContent>
          </Card>
        </div>

        <Card className="content-start lg:sticky lg:top-36">
          <CardHeader>
            <CardTitle>Order summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <ul className="grid gap-1.5">
              {group.lines.map((l) => (
                <li key={l.productId} className="flex justify-between gap-3">
                  <span className="truncate">{l.quantity}× {l.title}</span>
                  <span className="font-semibold">{money(l.lineCents, group.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="grid gap-2 border-t pt-3">
              <Field label="Promo code">
                <div className="flex gap-2">
                  <Input name="promoCode" defaultValue="" placeholder="e.g. MONTHEND10" className="h-9 uppercase" />
                  <Button type="submit" name="intent" value="quote" size="sm" variant="outline" formNoValidate><TagIcon /> Apply</Button>
                </div>
              </Field>
              {q?.promoError ? <p className="text-xs text-destructive">{q.promoError}</p> : null}
              <Field label="Gift coupon">
                <div className="flex gap-2">
                  <Input name="couponCode" placeholder="GIFT-XXXX-XXXX-XXXX" className="h-9 uppercase" />
                  <Button type="submit" name="intent" value="quote" size="sm" variant="outline" formNoValidate><GiftIcon /> Apply</Button>
                </div>
              </Field>
              {q?.couponError ? <p className="text-xs text-destructive">{q.couponError}</p> : null}
            </div>
            <dl className="grid gap-1 border-t pt-3">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(q?.subtotal ?? group.subtotalCents, group.currency)}</dd></div>
              {q?.discount ? <div className="flex justify-between text-success"><dt>Promo discount</dt><dd>-{money(q.discount, group.currency)}</dd></div> : null}
              {q?.couponUsed ? <div className="flex justify-between text-success"><dt>Paid with gift coupon</dt><dd>-{money(q.couponUsed, group.currency)}</dd></div> : null}
              <div className="flex justify-between text-lg font-black"><dt>To pay</dt><dd>{money(q?.toPay ?? group.subtotalCents, group.currency)}</dd></div>
            </dl>
            <FormError error={actionData && "error" in actionData ? actionData.error : null} />
            <Button type="submit" name="intent" value="place" size="lg" disabled={busy}>
              {busy ? "Placing order..." : "Place order"}
            </Button>
            <p className="text-xs text-muted-foreground">Delivery fees agreed with couriers are paid separately, as shown on your order.</p>
          </CardContent>
        </Card>
      </Form>
    </Container>
  );
}
