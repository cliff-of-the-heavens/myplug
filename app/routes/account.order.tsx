import { and, asc, eq, inArray } from "drizzle-orm";
import { CircleCheckBigIcon, MessageCircleIcon, ReceiptIcon, TruckIcon } from "lucide-react";
import { data, Form, Link, redirect, useSearchParams } from "react-router";
import { Container, FormError, PageHeader } from "~/components/page";
import { CustomerDelivery } from "~/components/customer-delivery";
import { PaymentReportForm } from "~/components/payment-report";
import { BillStatusBadge, DeliveryStatusBadge, OrderStatusBadge, OrderTracker } from "~/components/status";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { requireCustomer } from "~/lib/auth.server";
import { formatDay } from "~/lib/dates";
import { date, money, timeAgo } from "~/lib/format";
import { BILL_TERMS_DAYS } from "~/lib/orders";
import { acceptQuote, answerPickupApproval } from "~/lib/delivery.server";
import { OrderError } from "~/lib/orders.server";
import { uploadProof, UploadError } from "~/lib/upload.server";
import { str } from "~/lib/utils";
import { findOrCreateConversation } from "~/lib/messaging.server";
import type { Route } from "./+types/account.order";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `Order ${data.order.number} · MyPlug` : "Order · MyPlug" }];
}

async function loadOrder(customerId: string, id: string) {
  const order = await db.query.orders.findFirst({
    where: eq(schema.orders.id, id),
    with: {
      store: { columns: { id: true, name: true, slug: true } },
      items: true,
      events: { orderBy: asc(schema.orderEvents.createdAt) },
      delivery: {
        columns: { phraseHash: false },
        with: {
          courier: { columns: { id: true, name: true, phone: true, vehicle: true, plateNumber: true, facePhotoKey: true } },
          quotes: {
            columns: { id: true, status: true, estimateCents: true, quoteCents: true, note: true },
            with: { courier: { columns: { id: true, name: true, vehicle: true } } },
          },
        },
      },
      bill: true,
      plan: { columns: { id: true, number: true } },
    },
  });
  if (!order || order.customerId !== customerId) throw data("Order not found", { status: 404 });
  return order;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  return { order: await loadOrder(user.id, params.id) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const order = await loadOrder(user.id, params.id);
  const form = await request.formData();

  const intent = form.get("intent");
  if (intent === "accept-quote" || intent === "approve-pickup" || intent === "refuse-pickup") {
    try {
      if (intent === "accept-quote") await acceptQuote(user.id, str(form.get("quoteId")));
      else if (order.delivery) await answerPickupApproval(user.id, order.delivery.id, intent === "approve-pickup");
      return { ok: intent === "accept-quote" ? "Courier confirmed. The store has their details." : intent === "approve-pickup" ? "Pickup approved." : "Pickup refused. The store has been told not to hand it over." };
    } catch (e) {
      if (e instanceof OrderError) return { error: e.message };
      throw e;
    }
  }

  if (intent === "pay") {
    const reference = str(form.get("reference")).slice(0, 120);
    let proofUrl: string | null;
    try {
      proofUrl = await uploadProof(form.get("proof"), "payments");
    } catch (e) {
      if (e instanceof UploadError) return { error: e.message };
      throw e;
    }
    if (!reference && !proofUrl) return { error: "Enter the payment reference or attach proof of payment." };
    await db
      .update(schema.bills)
      .set({ submittedReference: reference || null, ...(proofUrl ? { proofUrl } : {}), submittedAt: new Date() })
      .where(and(eq(schema.bills.orderId, order.id), inArray(schema.bills.status, ["unpaid", "overdue"])));
    return { ok: "Thanks! The merchant will confirm your payment." };
  }

  const convo = await findOrCreateConversation({
    customerId: user.id,
    storeId: order.storeId,
    subject: `Order ${order.number}`,
  });
  return redirect(`/messages/${convo.id}`);
}

export default function OrderDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { order } = loaderData;
  const [params] = useSearchParams();
  const booking = !!order.bookingDate && !order.plan;
  const kind = booking ? "Booking" : "Order";
  const bill = order.bill;
  const canReportPayment =
    bill && (bill.status === "unpaid" || bill.status === "overdue") && order.status !== "cancelled" &&
    (order.paymentTiming === "prepaid" || order.status === "delivered");

  return (
    <Container className="max-w-4xl py-8">
      {params.get("placed") ? (
        <div className="mb-6 flex items-center gap-3 rounded-2xl bg-success/15 p-4 text-success">
          <CircleCheckBigIcon className="size-6 shrink-0" />
          <p className="font-semibold">
            {booking ? "Booking requested!" : "Order placed!"} {order.store.name} has been notified.
            {order.paymentTiming === "prepaid" ? " Pay in advance and report your payment below." : ""}
            {order.delivery === null ? " Once the seller confirms payment, find it in My library." : ""}
          </p>
        </div>
      ) : null}

      <PageHeader
        title={`${kind} ${order.number}`}
        description={
          <>
            {order.bookingDate ? (
              <>
                {booking ? "Booked for" : "Delivery on"}{" "}
                <strong className="text-foreground">{formatDay(order.bookingDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong>
                {" · "}
              </>
            ) : null}
            Placed {date(order.createdAt, true)} with{" "}
            <Link to={`/s/${order.store.slug}`} className="font-semibold text-accent hover:underline">
              {order.store.name}
            </Link>
            {order.plan ? (
              <>
                {" · part of repeat order "}
                <Link to="/account/plans" className="font-semibold text-accent hover:underline">{order.plan.number}</Link>
              </>
            ) : null}
          </>
        }
        actions={
          <Form method="post">
            <Button type="submit" variant="outline">
              <MessageCircleIcon /> Message seller
            </Button>
          </Form>
        }
      />

      <div className="grid gap-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Tracking</CardTitle>
            <OrderStatusBadge status={order.status} booking={booking} />
          </CardHeader>
          <CardContent>
            <OrderTracker status={order.status} events={order.events} booking={booking} />
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          {order.delivery && !booking && order.delivery.method !== "merchant" ? (
            <CustomerDelivery delivery={order.delivery} quotes={order.delivery.quotes} courier={order.delivery.courier} currency={order.currency} />
          ) : null}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <TruckIcon className="size-5 text-accent" /> {booking ? "Venue" : "Delivery"}
              </CardTitle>
              {order.delivery && !booking ? <DeliveryStatusBadge status={order.delivery.status} /> : null}
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p className="whitespace-pre-line">{order.shippingAddress}</p>
              {order.delivery?.courier ? (
                <p>
                  <span className="text-muted-foreground">Courier:</span> {order.delivery.courier}
                  {order.delivery.trackingNumber ? ` · ${order.delivery.trackingNumber}` : ""}
                </p>
              ) : null}
              {order.delivery?.dispatchedAt ? (
                <p><span className="text-muted-foreground">Dispatched:</span> {date(order.delivery.dispatchedAt, true)}</p>
              ) : null}
              {order.delivery?.deliveredAt ? (
                <p><span className="text-muted-foreground">Delivered:</span> {date(order.delivery.deliveredAt, true)}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ReceiptIcon className="size-5 text-primary" /> Bill
              </CardTitle>
              {order.bill ? <BillStatusBadge bill={order.bill} /> : null}
            </CardHeader>
            {bill ? (
              <CardContent className="grid gap-2 text-sm">
                <p className="text-2xl font-black">{money(bill.amountCents, order.currency)}</p>
                <p className="text-muted-foreground">
                  {order.paymentTiming === "prepaid"
                    ? "Pay in advance: the merchant starts once your payment is confirmed."
                    : `Pay after ${booking ? "the event" : "delivery"}: due ${BILL_TERMS_DAYS} days after it's done.`}
                </p>
                <p><span className="text-muted-foreground">Due:</span> {date(bill.dueAt)}</p>
                {order.bill.paidAt ? (
                  <p><span className="text-muted-foreground">Paid:</span> {date(order.bill.paidAt, true)}</p>
                ) : null}
                {order.bill.paymentReference ? (
                  <p><span className="text-muted-foreground">Reference:</span> {order.bill.paymentReference}</p>
                ) : null}
                {actionData && "ok" in actionData ? <p className="font-medium text-success">{actionData.ok}</p> : null}
                <FormError error={actionData && "error" in actionData ? actionData.error : null} />
                {canReportPayment && bill.submittedAt ? (
                  <p className="rounded-lg bg-muted p-2">
                    You reported this payment {timeAgo(bill.submittedAt)}
                    {bill.submittedReference ? ` (ref ${bill.submittedReference})` : ""}. Waiting for the merchant to confirm.
                  </p>
                ) : canReportPayment ? (
                  <PaymentReportForm intent="pay" />
                ) : null}
              </CardContent>
            ) : null}
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {order.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-4 py-3 text-sm">
                  <span>
                    {i.productId ? (
                      <Link to={`/p/${i.productId}`} className="font-medium hover:text-primary">{i.title}</Link>
                    ) : (
                      i.title
                    )}{" "}
                    <span className="text-muted-foreground">× {i.quantity}</span>
                  </span>
                  <span className="font-semibold">{money(i.unitPriceCents * i.quantity, order.currency)}</span>
                </li>
              ))}
              <li className="flex justify-between pt-3 font-extrabold">
                <span>Total</span>
                <span>{money(order.totalCents, order.currency)}</span>
              </li>
            </ul>
            {order.notes ? <p className="mt-4 rounded-lg bg-muted p-3 text-sm">Your note: {order.notes}</p> : null}
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}
