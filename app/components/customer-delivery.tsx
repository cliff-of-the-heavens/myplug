import { AlertTriangleIcon, BadgeCheckIcon, BikeIcon, CheckIcon, KeyRoundIcon, PhoneIcon, XIcon } from "lucide-react";
import { Form, useNavigation } from "react-router";
import type { Delivery } from "~/db/schema";
import { HANDOVER_LABEL, METHOD_LABEL, SECOND_CHECK_LABEL } from "~/lib/delivery";
import { date, money } from "~/lib/format";
import { usePolling } from "~/lib/hooks";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

type Quote = { id: string; status: string; estimateCents: number | null; quoteCents: number | null; note: string | null; courier: { id: string; name: string; vehicle: string | null } };
type Courier = { id: string; name: string; phone: string; vehicle: string | null; plateNumber: string | null; facePhotoKey: string | null };

/** The customer's view of their delivery: quotes, who's collecting, the pickup code, and approvals. */
export function CustomerDelivery({
  delivery,
  quotes,
  courier,
  currency,
}: {
  delivery: Omit<Delivery, "phraseHash">;
  quotes: Quote[];
  courier: Courier | null;
  currency: string;
}) {
  const busy = useNavigation().state !== "idle";
  const needsApproval = !!delivery.approvalRequestedAt && !delivery.approvedAt && !delivery.pickedUpAt;
  const openQuotes = quotes.filter((q) => q.status === "quoted");
  usePolling(needsApproval || (!delivery.courierId && quotes.length) ? 8_000 : 60_000);

  return (
    <Card className={needsApproval ? "border-2 border-warning" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BikeIcon className="size-5 text-accent" /> {METHOD_LABEL[delivery.method]}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {needsApproval ? (
          <div className="grid gap-2 rounded-xl bg-warning/20 p-3">
            <p className="flex items-center gap-2 font-bold"><AlertTriangleIcon className="size-5" /> Someone with your pickup {delivery.verifyMethod === "code" ? "code" : "phrase"} is at the store</p>
            <p>Approve only if it's {courier ? courier.name : delivery.collectorName ?? "you"}. If not, refuse and the store won't hand it over.</p>
            <Form method="post" className="flex gap-2">
              <input type="hidden" name="deliveryId" value={delivery.id} />
              <Button type="submit" name="intent" value="approve-pickup" variant="accent" disabled={busy}><CheckIcon /> Approve pickup</Button>
              <Button type="submit" name="intent" value="refuse-pickup" variant="destructive" disabled={busy}><XIcon /> Refuse</Button>
            </Form>
          </div>
        ) : null}

        {!delivery.courierId && delivery.method === "courier" ? (
          <div className="grid gap-2">
            <p className="font-semibold">Courier quotes</p>
            {quotes.length === 0 ? <p className="text-muted-foreground">Waiting for couriers…</p> : null}
            {quotes.map((q) => (
              <div key={q.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                <span className="font-semibold">{q.courier.name}</span>
                <span className="text-xs text-muted-foreground">{q.courier.vehicle}</span>
                {q.status === "quoted" ? (
                  <>
                    <span className="ml-auto font-bold">{money(q.quoteCents ?? 0, currency)}</span>
                    {q.note ? <span className="w-full text-xs text-muted-foreground">“{q.note}”</span> : null}
                    <Form method="post">
                      <input type="hidden" name="quoteId" value={q.id} />
                      <Button type="submit" name="intent" value="accept-quote" size="sm" disabled={busy}>Accept</Button>
                    </Form>
                  </>
                ) : (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {q.status === "invited" ? `waiting${q.estimateCents ? ` (about ${money(q.estimateCents, currency)})` : ""}` : q.status}
                  </span>
                )}
              </div>
            ))}
            {openQuotes.length > 1 ? <p className="text-xs text-muted-foreground">Accepting one closes the bidding for the others.</p> : null}
          </div>
        ) : null}

        {courier ? (
          <div className="flex gap-3 rounded-xl border p-3">
            {courier.facePhotoKey ? <img src={`/files/courier/${courier.id}?which=face`} alt="" className="size-16 rounded-lg border object-cover" /> : null}
            <div className="grid gap-0.5">
              <p className="flex items-center gap-1.5 font-bold">{courier.name} <BadgeCheckIcon className="size-4 text-success" /></p>
              <a href={`tel:${courier.phone}`} className="flex items-center gap-1 text-accent"><PhoneIcon className="size-3.5" /> {courier.phone}</a>
              <p className="text-xs text-muted-foreground">{courier.vehicle} {courier.plateNumber ? `· ${courier.plateNumber}` : ""}{delivery.feeCents ? ` · fee ${money(delivery.feeCents, currency)} (${delivery.feePaidBy === "merchant" ? "paid by the store" : "you pay the courier"})` : ""}</p>
            </div>
          </div>
        ) : null}

        {delivery.method !== "merchant" ? (
          <div className="grid gap-1">
            <p><strong>Pickup:</strong> {delivery.pickupAt ? date(delivery.pickupAt, true) : "Any time"}</p>
            {delivery.method === "collection" ? (
              <p><strong>Collecting:</strong> {delivery.collectorName ? `${delivery.collectorName} (${delivery.collectorPhone}, ID ${delivery.collectorIdNumber})` : "You"}</p>
            ) : null}
            {delivery.method === "collection" && delivery.collectorName && !delivery.collectorPhotoKey ? (
              <p className="flex gap-1.5 text-xs text-highlight-foreground dark:text-warning"><AlertTriangleIcon className="size-4" /> No photo given for the collector: the risk of a wrong pickup is higher.</p>
            ) : null}
            {!delivery.pickedUpAt ? (
              <div className="mt-1 grid gap-1 rounded-xl bg-secondary p-3">
                <p className="flex items-center gap-1.5 font-semibold"><KeyRoundIcon className="size-4" /> {delivery.verifyMethod === "code" ? "Pickup code" : "Secret phrase"}</p>
                {delivery.verifyMethod === "code" ? (
                  <p className="font-mono text-2xl font-black tracking-[0.3em]">{delivery.handoverCode}</p>
                ) : (
                  <p>Tell your secret phrase only to the person collecting.</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {delivery.method === "collection" ? "Whoever collects gives this to the store." : "Your courier sees the code in their dashboard."} Never share it with anyone
                  else. Extra check: {SECOND_CHECK_LABEL[delivery.secondCheck].toLowerCase()}.
                </p>
              </div>
            ) : (
              <p className="text-success">Picked up {date(delivery.pickedUpAt, true)}</p>
            )}
          </div>
        ) : null}

        {delivery.method !== "collection" ? (
          <p>
            <strong>On arrival:</strong> {HANDOVER_LABEL[delivery.handover]}
            {delivery.handover === "delegate" ? ` to ${delivery.delegateName} (${delivery.delegatePhone})` : ""}
          </p>
        ) : null}
        {delivery.approvalDeniedAt ? <Badge variant="destructive">You refused a pickup on {date(delivery.approvalDeniedAt, true)}</Badge> : null}
      </CardContent>
    </Card>
  );
}
