import { AlertTriangleIcon, BadgeCheckIcon, BikeIcon, KeyRoundIcon, PhoneIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react";
import { Form, useNavigation } from "react-router";
import type { Delivery, OrderStatus } from "~/db/schema";
import { HANDOVER_LABEL, METHOD_LABEL } from "~/lib/delivery";
import { date, money } from "~/lib/format";
import { usePolling } from "~/lib/hooks";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";

type Courier = { id: string; name: string; phone: string; vehicle: string | null; plateNumber: string | null; status: string; facePhotoKey: string | null };
type Quote = { id: string; status: string; quoteCents: number | null; courier: { name: string } };
type Log = { id: string; action: string; detail: string | null; createdAt: Date | string; actor: string | null };

/** Local date-time string for a datetime-local input. */
function toLocalInput(d: Date | string | null) {
  if (!d) return "";
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/**
 * The merchant's side of a pickup: who is coming (with photo), when, checking their code or
 * phrase, the customer's extra confirmation, and finally releasing the item. Everything is logged.
 */
export function PickupPanel({
  delivery,
  courier,
  quotes,
  logs,
  customerPhone,
  orderStatus,
  currency,
}: {
  delivery: Omit<Delivery, "handoverCode" | "phraseHash">;
  courier: Courier | null;
  quotes: Quote[];
  logs: Log[];
  customerPhone: string | null;
  orderStatus: OrderStatus;
  currency: string;
}) {
  const busy = useNavigation().state !== "idle";
  const waitingApproval = !!delivery.approvalRequestedAt && !delivery.approvedAt && !delivery.pickedUpAt;
  usePolling(waitingApproval ? 5_000 : 60_000);
  const collection = delivery.method === "collection";
  const selfDelivery = delivery.method === "merchant";
  const ready = orderStatus !== "pending" && orderStatus !== "cancelled";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BikeIcon className="size-5 text-accent" /> {METHOD_LABEL[delivery.method]}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div className="grid gap-1">
          <p><strong>Deliver to:</strong> {delivery.recipientName} · {delivery.recipientPhone}</p>
          {!collection ? (
            <p>
              <strong>On arrival:</strong> {HANDOVER_LABEL[delivery.handover]}
              {delivery.handover === "delegate" ? ` to ${delivery.delegateName} (${delivery.delegatePhone})` : ""}
            </p>
          ) : null}
          {delivery.feeCents ? (
            <p><strong>Delivery fee:</strong> {money(delivery.feeCents, currency)} · paid by {delivery.feePaidBy === "merchant" ? "you" : "the customer"}</p>
          ) : null}
        </div>

        {selfDelivery ? (
          <p className="text-muted-foreground">You deliver this yourself: move the order to Shipped and Delivered as it goes.</p>
        ) : (
          <>
            {/* Who is collecting */}
            {collection ? (
              <div className="grid gap-2 rounded-xl border p-3">
                <p className="flex items-center gap-1.5 font-bold"><UserRoundIcon className="size-4" /> Collecting</p>
                {delivery.collectorName ? (
                  <div className="flex gap-3">
                    {delivery.collectorPhotoKey ? (
                      <img src={`/files/collector/${delivery.id}`} alt="" className="size-20 rounded-lg border object-cover" />
                    ) : null}
                    <div className="grid gap-0.5">
                      <p className="font-semibold">{delivery.collectorName}</p>
                      <p>Phone {delivery.collectorPhone} · ID number <strong>{delivery.collectorIdNumber}</strong></p>
                      <p className="text-xs text-muted-foreground">Check their ID document matches this number{delivery.collectorPhotoKey ? " and their face matches the photo" : ""}.</p>
                    </div>
                  </div>
                ) : (
                  <p>The customer is collecting in person. Check their ID matches the order name: {delivery.recipientName}.</p>
                )}
                {delivery.collectorName && !delivery.collectorPhotoKey ? (
                  <p className="flex gap-2 rounded-lg bg-warning/20 p-2 text-xs"><AlertTriangleIcon className="size-4 shrink-0" /> No photo was provided for this collector. Check their ID carefully.</p>
                ) : null}
              </div>
            ) : courier ? (
              <div className="flex gap-3 rounded-xl border p-3">
                {courier.facePhotoKey ? <img src={`/files/courier/${courier.id}?which=face`} alt="" className="size-20 rounded-lg border object-cover" /> : null}
                <div className="grid gap-0.5">
                  <p className="flex items-center gap-1.5 font-bold">
                    {courier.name} {courier.status === "approved" ? <BadgeCheckIcon className="size-4 text-success" /> : null}
                  </p>
                  <a href={`tel:${courier.phone}`} className="flex items-center gap-1 text-accent"><PhoneIcon className="size-3.5" /> {courier.phone}</a>
                  <p className="text-muted-foreground">{courier.vehicle ?? ""} {courier.plateNumber ? `· ${courier.plateNumber}` : ""}</p>
                  <p className="text-xs text-muted-foreground">Registered courier, ID checked by MyPlug. Make sure the person matches this photo.</p>
                </div>
              </div>
            ) : (
              <div className="grid gap-1 rounded-xl border border-dashed p-3">
                <p className="font-semibold">No courier confirmed yet</p>
                {quotes.length ? (
                  <ul className="text-xs text-muted-foreground">
                    {quotes.map((q) => (
                      <li key={q.id}>{q.courier.name}: {q.status}{q.quoteCents ? ` (${money(q.quoteCents, currency)})` : ""}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {delivery.method === "merchant_courier" ? "Your courier is asked once you confirm the order." : "Waiting for couriers to respond."}
                  </p>
                )}
                {delivery.method === "merchant_courier" ? (
                  <Form method="post">
                    <Button type="submit" name="intent" value="self-deliver" size="sm" variant="ghost">Deliver it myself instead</Button>
                  </Form>
                ) : null}
              </div>
            )}

            {/* Pickup time (editable) */}
            <Form method="post" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="intent" value="pickup-time" />
              <label className="grid gap-1">
                <span className="text-xs font-semibold">Pickup time</span>
                <Input name="pickupAt" type="datetime-local" defaultValue={toLocalInput(delivery.pickupAt)} className="h-9" />
              </label>
              <Button type="submit" size="sm" variant="outline" disabled={busy}>Save</Button>
              <span className="text-xs text-muted-foreground">{delivery.pickupAt ? date(delivery.pickupAt, true) : "Any time"} · leave empty for any time</span>
            </Form>

            {/* Verification and release */}
            {delivery.pickedUpAt ? (
              <p className="flex items-center gap-2 rounded-xl bg-success/15 p-3 font-medium text-success">
                <ShieldCheckIcon className="size-5" /> Handed over {date(delivery.pickedUpAt, true)}
              </p>
            ) : !ready ? (
              <p className="text-muted-foreground">Confirm the order before handing anything over.</p>
            ) : (
              <div className="grid gap-3 rounded-xl border-2 border-primary/40 p-3">
                <p className="flex items-center gap-1.5 font-bold"><KeyRoundIcon className="size-4 text-primary" /> Release the item</p>
                {!delivery.codeVerifiedAt ? (
                  <Form method="post" className="grid gap-2">
                    <input type="hidden" name="intent" value="verify" />
                    <p>Ask the person collecting for the {delivery.verifyMethod === "code" ? "6-character pickup code" : "customer's secret phrase"}.</p>
                    <div className="flex gap-2">
                      <Input name="given" required autoComplete="off" placeholder={delivery.verifyMethod === "code" ? "e.g. 7K2Q9A" : "Secret phrase"} className="h-9" />
                      <Button type="submit" size="sm" disabled={busy}>Check</Button>
                    </div>
                    {delivery.verifyAttempts ? <p className="text-xs text-destructive">{delivery.verifyAttempts} wrong attempt(s) so far.</p> : null}
                  </Form>
                ) : (
                  <p className="flex items-center gap-1.5 text-success"><BadgeCheckIcon className="size-4" /> {delivery.verifyMethod === "code" ? "Code" : "Phrase"} confirmed</p>
                )}

                {delivery.codeVerifiedAt && delivery.secondCheck === "app" ? (
                  delivery.approvedAt ? (
                    <p className="flex items-center gap-1.5 text-success"><BadgeCheckIcon className="size-4" /> Customer approved the pickup</p>
                  ) : (
                    <p className="rounded-lg bg-warning/20 p-2">Waiting for the customer to approve in the app or by email… This page updates by itself.</p>
                  )
                ) : null}

                {delivery.codeVerifiedAt && (delivery.secondCheck !== "app" || delivery.approvedAt) ? (
                  <Form method="post" className="grid gap-2">
                    <input type="hidden" name="intent" value="release" />
                    {delivery.secondCheck === "phone" ? (
                      <label className="flex items-start gap-2">
                        <input type="checkbox" name="phoneConfirmed" required className="mt-0.5 size-4 accent-primary" />
                        <span>
                          I called the customer{customerPhone ? (
                            <> on <a href={`tel:${customerPhone}`} className="font-semibold text-accent">{customerPhone}</a></>
                          ) : null}{" "}
                          and they confirmed this person may collect.
                        </span>
                      </label>
                    ) : null}
                    <Button type="submit" variant="accent" disabled={busy}>
                      <ShieldCheckIcon /> Hand over now
                    </Button>
                    <p className="text-xs text-muted-foreground">Everyone is notified straight away and the handover is logged.</p>
                  </Form>
                ) : null}
              </div>
            )}
          </>
        )}

        {logs.length ? (
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold">Activity log ({logs.length})</summary>
            <ul className="mt-2 grid gap-1">
              {logs.map((l) => (
                <li key={l.id}>
                  <Badge variant="muted">{date(l.createdAt, true)}</Badge> {l.action}
                  {l.detail ? ` · ${l.detail}` : ""}
                  {l.actor ? ` · by ${l.actor}` : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
