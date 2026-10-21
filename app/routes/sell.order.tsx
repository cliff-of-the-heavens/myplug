import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { MessageCircleIcon, ReceiptIcon, TruckIcon } from "lucide-react";
import { useState } from "react";
import { data, Form, redirect, useNavigation } from "react-router";
import { FormError, PageHeader } from "~/components/page";
import { BillStatusBadge, DeliveryStatusBadge, OrderStatusBadge, OrderTracker, statusLabel } from "~/components/status";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input, NativeSelect } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { orderStatus, type BillStatus, type OrderStatus } from "~/db/schema";
import { requireMerchant } from "~/lib/auth.server";
import { formatDay } from "~/lib/dates";
import { date, effectiveBillStatus, money, ORDER_STATUS_LABEL, timeAgo } from "~/lib/format";
import { findOrCreateConversation } from "~/lib/messaging.server";
import { nextStatuses, OrderError, updateOrderStatus } from "~/lib/orders.server";
import { deliveryLogFor, inviteStoreCourier, releaseItem, setPickupTime, verifyCollector } from "~/lib/delivery.server";
import { notify } from "~/lib/notify.server";
import { activateGrantForOrder } from "~/lib/digital.server";
import { PickupPanel } from "~/components/pickup-panel";
import { str } from "~/lib/utils";
import type { Route } from "./+types/sell.order";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `Order ${data.order.number} · MyPlug` : "Order · MyPlug" }];
}

async function loadOrder(storeId: string, id: string) {
  const order = await db.query.orders.findFirst({
    where: eq(schema.orders.id, id),
    with: {
      customer: { columns: { id: true, name: true, email: true, phone: true } },
      items: true,
      events: { orderBy: asc(schema.orderEvents.createdAt) },
      delivery: {
        // The store checks the code/phrase, so it must never see them.
        columns: { handoverCode: false, phraseHash: false },
        with: {
          courier: { columns: { id: true, name: true, phone: true, vehicle: true, plateNumber: true, status: true, facePhotoKey: true } },
          quotes: { columns: { id: true, status: true, quoteCents: true }, with: { courier: { columns: { name: true } } } },
        },
      },
      bill: true,
      plan: { columns: { number: true } },
    },
  });
  if (!order || order.storeId !== storeId) throw data("Order not found", { status: 404 });
  return order;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const order = await loadOrder(user.storeId, params.id);
  // A dated order that isn't a repeat delivery is a service booking.
  const booking = !!order.bookingDate && !order.planId;
  const logs = order.delivery ? await deliveryLogFor(order.delivery.id) : [];
  return { order, booking, logs, next: nextStatuses({ status: order.status, kind: booking ? "service" : "product" }) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireMerchant(request);
  const order = await loadOrder(user.storeId, params.id);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "status") {
    const status = str(form.get("status")) as OrderStatus;
    if (!orderStatus.enumValues.includes(status)) return { error: "Choose a status." };
    try {
      await updateOrderStatus({
        orderId: order.id,
        storeId: user.storeId,
        status,
        note: str(form.get("note")),
        actorId: user.id,
        courier: str(form.get("courier")),
        trackingNumber: str(form.get("trackingNumber")),
        receivedBy: str(form.get("receivedBy")),
      });
      if (status === "confirmed") await inviteStoreCourier(order.id); // the store's courier gets the job
      await notify([order.customerId], {
        title: `Order ${order.number}: ${ORDER_STATUS_LABEL[status]}`,
        body: str(form.get("note")) || undefined,
        href: `/account/orders/${order.id}`,
      });
      return { ok: true };
    } catch (e) {
      if (e instanceof OrderError) return { error: e.message };
      throw e;
    }
  }

  // ---- pickup by a courier or collector
  const deliveryId = order.delivery?.id;
  if (deliveryId && ["pickup-time", "verify", "release", "self-deliver"].includes(String(intent))) {
    try {
      if (intent === "pickup-time") {
        const raw = str(form.get("pickupAt"));
        const at = raw ? new Date(raw) : null;
        if (at && Number.isNaN(at.getTime())) return { error: "Choose a valid time." };
        await setPickupTime(user.storeId, deliveryId, at, user.id);
      } else if (intent === "verify") {
        await verifyCollector(user.storeId, deliveryId, str(form.get("given")), user.id);
      } else if (intent === "release") {
        await releaseItem(user.storeId, deliveryId, user.id, { phoneConfirmed: form.get("phoneConfirmed") === "on" });
      } else if (intent === "self-deliver") {
        await db
          .update(schema.deliveries)
          .set({ method: "merchant", courierId: null })
          .where(and(eq(schema.deliveries.id, deliveryId), eq(schema.deliveries.method, "merchant_courier")));
      }
      return { ok: true };
    } catch (e) {
      if (e instanceof OrderError) return { error: e.message };
      throw e;
    }
  }

  if (intent === "delivery-failed" || intent === "delivery-returned") {
    await db
      .update(schema.deliveries)
      .set({ status: intent === "delivery-failed" ? "failed" : "returned" })
      .where(eq(schema.deliveries.orderId, order.id));
    return { ok: true };
  }

  // Bill transitions only apply from the states the UI offers them in.
  const billWhere = (...from: BillStatus[]) =>
    and(eq(schema.bills.orderId, order.id), inArray(schema.bills.status, from));

  if (intent === "bill-paid") {
    await db
      .update(schema.bills)
      .set({ status: "paid", paidAt: new Date(), paymentReference: str(form.get("reference")) || null })
      .where(billWhere("unpaid", "overdue"));
    await activateGrantForOrder(order.id, user.id); // digital purchases: access starts on payment
    await notify([order.customerId], { title: `Payment for order ${order.number} confirmed`, href: `/account/orders/${order.id}` });
    return { ok: true };
  }
  if (intent === "bill-defaulted") {
    // Only once the bill is actually past due
    await db
      .update(schema.bills)
      .set({ status: "defaulted" })
      .where(and(billWhere("unpaid", "overdue"), lt(schema.bills.dueAt, new Date())));
    return { ok: true };
  }
  if (intent === "bill-reopen") {
    await db
      .update(schema.bills)
      .set({ status: "unpaid", paidAt: null, paymentReference: null })
      .where(billWhere("paid", "defaulted"));
    return { ok: true };
  }

  if (intent === "message") {
    const convo = await findOrCreateConversation({
      customerId: order.customerId,
      storeId: user.storeId,
      subject: `Order ${order.number}`,
    });
    return redirect(`/messages/${convo.id}`);
  }

  throw data("Unknown action", { status: 400 });
}

function StatusForm({ next, booking }: { next: OrderStatus[]; booking: boolean }) {
  const [status, setStatus] = useState<OrderStatus | "">(next[0] ?? "");
  const busy = useNavigation().formData?.get("intent") === "status";
  if (!next.length) return <p className="text-sm text-muted-foreground">This {booking ? "booking" : "order"} is complete.</p>;

  return (
    <Form method="post" className="grid gap-3">
      <input type="hidden" name="intent" value="status" />
      <Field label={`Move ${booking ? "booking" : "order"} to`}>
        <NativeSelect name="status" value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>
          {next.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s, booking)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {status === "shipped" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Courier">
            <Input name="courier" placeholder="e.g. The Courier Guy" />
          </Field>
          <Field label="Tracking number">
            <Input name="trackingNumber" />
          </Field>
        </div>
      ) : null}
      {status === "delivered" && !booking ? (
        <Field label="Received by">
          <Input name="receivedBy" placeholder="Name of person who signed" />
        </Field>
      ) : null}
      <Field label="Note to customer (optional)">
        <Input name="note" placeholder={status === "cancelled" ? "Reason for cancelling" : ""} />
      </Field>
      <Button type="submit" disabled={busy} variant={status === "cancelled" ? "destructive" : "default"}>
        {busy ? "Updating..." : `Mark as ${status ? statusLabel(status, booking).toLowerCase() : ""}`}
      </Button>
    </Form>
  );
}

export default function SellOrder({ loaderData, actionData }: Route.ComponentProps) {
  const { order, next, booking } = loaderData;
  const billStatus = order.bill ? effectiveBillStatus(order.bill) : null;
  const prepaidUnpaid = order.paymentTiming === "prepaid" && billStatus !== "paid" && order.status !== "cancelled";

  return (
    <>
      <PageHeader
        title={`${booking ? "Booking" : "Order"} ${order.number}`}
        description={
          <>
            {order.bookingDate ? (
              <strong className="text-foreground">
                {booking ? "Event on " : "Deliver on "}
                {formatDay(order.bookingDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} ·{" "}
              </strong>
            ) : null}
            Placed {date(order.createdAt, true)}
            {order.plan ? ` · repeat order ${order.plan.number}` : ""}
            {" · "}
            {order.paymentTiming === "prepaid" ? "Paid in advance" : `Pay after ${booking ? "the event" : "delivery"}`}
          </>
        }
        actions={
          <Form method="post">
            <Button type="submit" name="intent" value="message" variant="outline">
              <MessageCircleIcon /> Message customer
            </Button>
          </Form>
        }
      />
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      {prepaidUnpaid ? (
        <p className="mt-3 rounded-lg bg-warning/20 px-3 py-2 text-sm">
          <strong>Prepaid order:</strong> wait for the payment and mark the bill paid before you{" "}
          {booking ? "complete the booking" : "dispatch it"}.
        </p>
      ) : null}

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Tracking</CardTitle>
              <OrderStatusBadge status={order.status} booking={booking} />
            </CardHeader>
            <CardContent>
              <OrderTracker status={order.status} events={order.events} booking={booking} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {order.items.map((i) => (
                  <li key={i.id} className="flex justify-between py-2">
                    <span>
                      {i.title} <span className="text-muted-foreground">× {i.quantity}</span>
                    </span>
                    <span className="font-semibold">{money(i.unitPriceCents * i.quantity, order.currency)}</span>
                  </li>
                ))}
                <li className="flex justify-between pt-2 font-extrabold">
                  <span>Total</span>
                  <span>{money(order.totalCents, order.currency)}</span>
                </li>
              </ul>
              {order.notes ? <p className="mt-4 rounded-lg bg-muted p-3 text-sm">Customer note: {order.notes}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1 text-sm">
              <p className="font-semibold">{order.customer.name}</p>
              <p className="text-muted-foreground">{order.customer.email}</p>
              {order.customer.phone ? <p className="text-muted-foreground">{order.customer.phone}</p> : null}
              <p className="mt-2 whitespace-pre-line">{order.shippingAddress}</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle>Update {booking ? "booking" : "order"}</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusForm key={order.status} next={next} booking={booking} />
            </CardContent>
          </Card>

          {order.delivery && !booking && order.delivery.method !== "merchant" ? (
            <PickupPanel
              delivery={order.delivery}
              courier={order.delivery.courier}
              quotes={order.delivery.quotes}
              logs={loaderData.logs}
              customerPhone={order.customer.phone}
              orderStatus={order.status}
              currency={order.currency}
            />
          ) : null}

          {order.delivery && !booking ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <TruckIcon className="size-5 text-accent" /> Delivery
                </CardTitle>
                <DeliveryStatusBadge status={order.delivery.status} />
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {order.delivery.courier ? <p>Courier: {order.delivery.courier} {order.delivery.trackingNumber}</p> : null}
                {order.delivery.dispatchedAt ? <p>Dispatched {date(order.delivery.dispatchedAt, true)}</p> : null}
                {order.delivery.deliveredAt ? <p>Delivered {date(order.delivery.deliveredAt, true)}</p> : null}
                {order.delivery.receivedBy ? <p>Signed by {order.delivery.receivedBy}</p> : null}
                {order.delivery.status === "in_transit" ? (
                  <Form method="post" className="flex gap-2">
                    <Button type="submit" name="intent" value="delivery-failed" variant="outline" size="sm">
                      Delivery failed
                    </Button>
                    <Button type="submit" name="intent" value="delivery-returned" variant="outline" size="sm">
                      Returned
                    </Button>
                  </Form>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {order.bill ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <ReceiptIcon className="size-5 text-primary" /> Bill
                </CardTitle>
                <BillStatusBadge bill={order.bill} />
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <p>
                  <span className="text-2xl font-black">{money(order.bill.amountCents, order.currency)}</span>
                  <span className="text-muted-foreground"> due {date(order.bill.dueAt)}</span>
                </p>
                {order.bill.paidAt ? (
                  <p>Paid {date(order.bill.paidAt, true)} {order.bill.paymentReference ? `· Ref ${order.bill.paymentReference}` : ""}</p>
                ) : null}
                {order.bill.submittedAt && (billStatus === "unpaid" || billStatus === "overdue") ? (
                  <div className="grid gap-1 rounded-lg border-2 border-dashed p-2">
                    <p>
                      <strong>Customer says they've paid</strong> ({timeAgo(order.bill.submittedAt)})
                      {order.bill.submittedReference ? (
                        <>
                          {" "}· ref <span className="font-mono">{order.bill.submittedReference}</span>
                        </>
                      ) : null}
                    </p>
                    {order.bill.proofUrl ? (
                      <a href={order.bill.proofUrl} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">
                        Open proof of payment
                      </a>
                    ) : null}
                    <p className="text-xs text-muted-foreground">Check your account before marking it paid.</p>
                  </div>
                ) : null}
                {billStatus === "unpaid" || billStatus === "overdue" ? (
                  <>
                    <Form method="post" className="flex gap-2">
                      <Input name="reference" placeholder="Payment reference" defaultValue={order.bill.submittedReference ?? ""} className="h-8" />
                      <Button type="submit" name="intent" value="bill-paid" size="sm" variant="accent">
                        Mark paid
                      </Button>
                    </Form>
                    {billStatus === "overdue" ? (
                      <Form method="post">
                        <Button type="submit" name="intent" value="bill-defaulted" size="sm" variant="outline" className="w-full">
                          Mark as not honoured
                        </Button>
                      </Form>
                    ) : null}
                  </>
                ) : billStatus === "paid" || billStatus === "defaulted" ? (
                  <Form method="post">
                    <Button type="submit" name="intent" value="bill-reopen" size="sm" variant="ghost">
                      Undo — mark unpaid
                    </Button>
                  </Form>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
