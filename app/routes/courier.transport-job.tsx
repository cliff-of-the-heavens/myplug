import { CheckIcon, PhoneIcon } from "lucide-react";
import { data, Form, Link, useNavigation } from "react-router";
import { Container, FormError, PageHeader } from "~/components/page";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input } from "~/components/ui/input";
import { requireCourier } from "~/lib/auth.server";
import { date, money, parseMoney, timeAgo } from "~/lib/format";
import { JOB_STATUS, TRANSPORT_LABEL } from "~/lib/transport";
import { completeJob, jobForCourier, makeOffer, TransportError, withdrawOffer } from "~/lib/transport.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/courier.transport-job";

export const meta: Route.MetaFunction = ({ data }) => [{ title: data ? `${data.job.number} · MyPlug` : "Transport job · MyPlug" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireCourier(request);
  const job = await jobForCourier(user.courierId, params.id);
  if (!job) throw data("This request isn't available any more.", { status: 404 });
  return { job };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireCourier(request);
  const form = await request.formData();
  try {
    const intent = form.get("intent");
    if (intent === "withdraw") await withdrawOffer(user.courierId, params.id);
    else if (intent === "complete") await completeJob(params.id, { courierId: user.courierId });
    else await makeOffer(user.courierId, params.id, parseMoney(form.get("price")), str(form.get("note")));
    return { ok: intent === "complete" ? "Marked as done." : intent === "withdraw" ? "Offer withdrawn." : "Price sent to the customer." };
  } catch (e) {
    if (e instanceof TransportError) return { error: e.message };
    throw e;
  }
}

export default function CourierTransportJob({ loaderData, actionData }: Route.ComponentProps) {
  const { job } = loaderData;
  const busy = useNavigation().state !== "idle";
  const offer = job.myOffer?.status === "offered" ? job.myOffer : null;
  return (
    <Container className="max-w-3xl py-8">
      <Link to="/courier/transport" className="mb-3 block w-fit text-sm text-muted-foreground hover:text-primary">
        ← Transport jobs
      </Link>
      <PageHeader
        title={`${TRANSPORT_LABEL[job.type]}: ${job.pickup}${job.dropoff ? ` → ${job.dropoff}` : ""}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {job.number} · {job.customerName} · posted {timeAgo(job.createdAt)}
            <Badge variant={JOB_STATUS[job.status].tone}>{JOB_STATUS[job.status].label}</Badge>
          </span>
        }
      />
      {actionData && "ok" in actionData ? <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />

      <Card className="mb-6">
        <CardContent className="grid gap-2 pt-5 text-sm">
          <p>
            <strong>When:</strong>{" "}
            {job.type === "car_hire" && job.when && job.untilDate ? `${date(job.when)} to ${date(job.untilDate)}` : job.when ? date(job.when, true) : "As soon as possible"}
          </p>
          {job.passengers ? (
            <p>
              <strong>Passengers:</strong> {job.passengers}
            </p>
          ) : null}
          {job.details ? <p className="whitespace-pre-line">{job.details}</p> : null}
          {job.budgetCents ? (
            <p>
              <strong>Customer's budget:</strong> {money(job.budgetCents)}
            </p>
          ) : null}
          {job.imageUrl ? <SafeImage src={job.imageUrl} alt="" className="max-h-64 w-fit rounded-xl" imgClassName="object-contain" /> : null}
          {job.booked && job.contactPhone ? (
            <a href={`tel:${job.contactPhone}`} className="mt-2 flex w-fit items-center gap-1 text-base font-bold text-accent hover:underline">
              <PhoneIcon className="size-5" /> Call {job.customerName}: {job.contactPhone}
            </a>
          ) : null}
        </CardContent>
      </Card>

      {job.status === "open" ? (
        <Card>
          <CardHeader>
            <CardTitle>{offer ? `Your price: ${money(offer.priceCents)}` : "Send your price"}</CardTitle>
          </CardHeader>
          <CardContent>
            <Form method="post" className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                <Field label="Price (MK)">
                  <Input name="price" inputMode="decimal" required defaultValue={offer ? String(offer.priceCents / 100) : ""} />
                </Field>
                <Field label="Note (optional)">
                  <Input name="note" maxLength={500} defaultValue={offer?.note ?? ""} placeholder="e.g. 3-tonne truck, 2 helpers, can be there by 8am" />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" name="intent" value="offer" disabled={busy}>
                  {offer ? "Update price" : "Send price"}
                </Button>
                {offer ? (
                  <Button type="submit" name="intent" value="withdraw" variant="ghost" disabled={busy} formNoValidate>
                    Withdraw
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">If the customer accepts, you'll get their phone number. They pay you directly, as agreed.</p>
            </Form>
          </CardContent>
        </Card>
      ) : job.booked && job.status === "booked" ? (
        <Form method="post">
          <Button type="submit" name="intent" value="complete" disabled={busy}>
            <CheckIcon /> Mark as done
          </Button>
        </Form>
      ) : null}
    </Container>
  );
}
