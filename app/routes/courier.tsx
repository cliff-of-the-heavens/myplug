import { BikeIcon, CheckIcon, MapPinIcon, PackageIcon, PhoneIcon, StoreIcon, XIcon } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import { Container, EmptyState, FormError, PageHeader } from "~/components/page";
import { OrderStatusBadge } from "~/components/status";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { requireCourier } from "~/lib/auth.server";
import { courierJobs, getCourier } from "~/lib/couriers.server";
import { HANDOVER_LABEL } from "~/lib/delivery";
import { courierDelivered, respondToQuote } from "~/lib/delivery.server";
import { date, money, parseMoney, timeAgo } from "~/lib/format";
import { usePolling } from "~/lib/hooks";
import { OrderError } from "~/lib/orders.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/courier";

export const meta: Route.MetaFunction = () => [{ title: "Courier dashboard · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCourier(request);
  const [courier, { invites, jobs }] = await Promise.all([getCourier(user.courierId), courierJobs(user.courierId)]);
  return { courier: courier!, invites, jobs };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCourier(request);
  const courier = await getCourier(user.courierId);
  if (courier?.status !== "approved") return { error: "Your account must be approved before you can take jobs." };
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    if (intent === "quote" || intent === "decline") {
      await respondToQuote(user.courierId, str(form.get("quoteId")), {
        priceCents: parseMoney(form.get("price")),
        note: str(form.get("note")).slice(0, 300),
        decline: intent === "decline",
      });
      return { ok: intent === "decline" ? "Request declined." : "Price sent." };
    }
    if (intent === "delivered") {
      await courierDelivered(user.courierId, str(form.get("deliveryId")), user.id, str(form.get("note")).slice(0, 200));
      return { ok: "Marked as delivered. The customer and store have been told." };
    }
  } catch (e) {
    if (e instanceof OrderError) return { error: e.message };
    throw e;
  }
  return { error: "Unknown action." };
}

export default function CourierDashboard({ loaderData, actionData }: Route.ComponentProps) {
  const { courier, invites, jobs } = loaderData;
  const busy = useNavigation().state !== "idle";
  usePolling(15_000);
  const active = jobs.filter((j) => j.order.status !== "delivered" && j.order.status !== "cancelled");
  const done = jobs.filter((j) => j.order.status === "delivered");

  return (
    <Container className="max-w-4xl py-8">
      <PageHeader
        title="Courier dashboard"
        description={courier.name}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/courier/reviews">My ratings</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/courier/profile">Profile & prices</Link>
            </Button>
          </div>
        }
      />
      {courier.status !== "approved" ? (
        <p className="mb-4 rounded-lg bg-warning/20 px-3 py-2 text-sm">
          {courier.status === "pending"
            ? "Your account is waiting for approval. Make sure your face photo and ID are uploaded under Profile."
            : `Your account is ${courier.status}.${courier.reviewNote ? ` Note: ${courier.reviewNote}` : ""}`}
        </p>
      ) : null}
      {actionData && "ok" in actionData ? (
        <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p>
      ) : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />

      <h2 className="mt-4 mb-3 text-lg font-bold">Delivery requests</h2>
      {invites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open requests. Add areas and prices to your profile to get more.</p>
      ) : (
        <div className="grid gap-3">
          {invites.map((q) => (
            <Card key={q.quoteId}>
              <CardContent className="grid gap-2 pt-5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{q.storeName}</span>
                  <span className="text-muted-foreground">→ {q.area}, {q.city}</span>
                  {q.direct ? <Badge variant="accent">Asked you directly</Badge> : <Badge variant="secondary">Bidding</Badge>}
                  {q.feePaidBy === "merchant" ? <Badge variant="outline">Paid by the store</Badge> : null}
                  <span className="ml-auto text-xs text-muted-foreground">{timeAgo(q.createdAt)}</span>
                </div>
                <p className="text-muted-foreground">
                  Order {q.orderNumber} · pickup {q.pickupAt ? date(q.pickupAt, true) : "any time"}
                  {q.storeArea ? ` · from ${q.storeArea}` : ""}
                  {q.estimateCents ? ` · your listed price ${money(q.estimateCents, q.currency)}` : ""}
                </p>
                {q.status === "quoted" ? (
                  <p className="font-medium">You quoted {money(q.quoteCents ?? 0, q.currency)}. Waiting for the customer to choose.</p>
                ) : (
                  <Form method="post" className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="quoteId" value={q.quoteId} />
                    <Input name="price" inputMode="decimal" placeholder="Your price" defaultValue={q.estimateCents ? q.estimateCents / 100 : ""} className="h-9 w-32" />
                    <Input name="note" placeholder="Note (optional)" className="h-9 flex-1" />
                    <Button type="submit" name="intent" value="quote" size="sm" disabled={busy}>
                      <CheckIcon /> {q.direct ? "Accept job" : "Send price"}
                    </Button>
                    <Button type="submit" name="intent" value="decline" size="sm" variant="ghost" disabled={busy}>
                      <XIcon /> Decline
                    </Button>
                  </Form>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mt-8 mb-3 text-lg font-bold">Your jobs</h2>
      {active.length === 0 ? (
        <EmptyState icon={BikeIcon} title="No active jobs">
          Jobs you win appear here with pickup and drop-off details.
        </EmptyState>
      ) : (
        <div className="grid gap-4">
          {active.map((j) => (
            <Card key={j.id}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">Order {j.order.number}</CardTitle>
                <OrderStatusBadge status={j.order.status} />
              </CardHeader>
              <CardContent className="grid gap-4 text-sm md:grid-cols-2">
                <div className="grid content-start gap-1">
                  <p className="flex items-center gap-1.5 font-bold"><StoreIcon className="size-4 text-primary" /> Pick up</p>
                  <p>{j.order.store.name}</p>
                  {j.order.store.pickupAddress ? <p className="whitespace-pre-line text-muted-foreground">{j.order.store.pickupAddress}</p> : null}
                  {j.order.store.owner.phone ? (
                    <a href={`tel:${j.order.store.owner.phone}`} className="flex items-center gap-1 text-accent"><PhoneIcon className="size-3.5" /> {j.order.store.owner.phone}</a>
                  ) : null}
                  <p>
                    <strong>When:</strong> {j.pickupAt ? date(j.pickupAt, true) : "Any time"}
                  </p>
                  <p className="flex items-start gap-1.5"><PackageIcon className="mt-0.5 size-4" /> {j.order.items.map((i) => `${i.quantity}× ${i.title}`).join(", ")}</p>
                  {j.verifyMethod === "code" && j.handoverCode ? (
                    <p className="mt-1 rounded-lg bg-secondary px-3 py-2">
                      Give the store this pickup code: <strong className="font-mono text-lg tracking-widest">{j.handoverCode}</strong>
                    </p>
                  ) : (
                    <p className="mt-1 rounded-lg bg-secondary px-3 py-2">The customer will give you a secret phrase to say at the store.</p>
                  )}
                  <p className="text-xs text-muted-foreground">The store checks your photo and the code before handing over.</p>
                </div>
                <div className="grid content-start gap-1">
                  <p className="flex items-center gap-1.5 font-bold"><MapPinIcon className="size-4 text-primary" /> Deliver to</p>
                  <p className="whitespace-pre-line">{j.order.shippingAddress}</p>
                  <p>
                    <strong>Hand over:</strong> {HANDOVER_LABEL[j.handover]}
                    {j.handover === "delegate" ? ` to ${j.delegateName} (${j.delegatePhone})` : ""}
                  </p>
                  {j.recipientPhone ? (
                    <a href={`tel:${j.recipientPhone}`} className="flex items-center gap-1 text-accent"><PhoneIcon className="size-3.5" /> {j.recipientPhone}</a>
                  ) : null}
                  {j.order.notes ? <p className="text-muted-foreground">Note: {j.order.notes}</p> : null}
                  {j.feeCents ? (
                    <p>
                      <strong>Fee:</strong> {money(j.feeCents, j.order.currency)} · paid by {j.feePaidBy === "merchant" ? "the store" : "the customer"}
                    </p>
                  ) : null}
                  {j.pickedUpAt ? (
                    <Form method="post" className="mt-2 grid gap-2">
                      <input type="hidden" name="deliveryId" value={j.id} />
                      <Input name="note" placeholder="Received by / left at (e.g. Left with guard at gate)" required />
                      <Button type="submit" name="intent" value="delivered" size="sm" variant="accent" disabled={busy}>
                        <CheckIcon /> Mark delivered
                      </Button>
                    </Form>
                  ) : (
                    <p className="mt-2 text-muted-foreground">Waiting for the store to hand it over.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {done.length ? (
        <>
          <h2 className="mt-8 mb-3 text-lg font-bold">Delivered</h2>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {done.map((j) => (
              <li key={j.id} className="flex flex-wrap gap-3 px-4 py-2">
                <span className="font-semibold">{j.order.number}</span>
                <span>{j.order.store.name}</span>
                <span className="text-muted-foreground">{j.deliveredAt ? date(j.deliveredAt, true) : ""}</span>
                {j.feeCents ? <span className="ml-auto">{money(j.feeCents, j.order.currency)}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Container>
  );
}
