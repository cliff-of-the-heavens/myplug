import { CheckIcon, PhoneIcon } from "lucide-react";
import { data, Form, Link, useNavigation } from "react-router";
import { Container, FormError, PageHeader } from "~/components/page";
import { RateCourier } from "~/components/rate-courier";
import { RatingBadge } from "~/components/rating";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { requireCustomer } from "~/lib/auth.server";
import { date, money, timeAgo } from "~/lib/format";
import { usePolling } from "~/lib/hooks";
import { JOB_STATUS, TRANSPORT_LABEL } from "~/lib/transport";
import { courierRatings, ReviewError, reviewableTransport, submitTransportReview } from "~/lib/reviews.server";
import { acceptOffer, cancelJob, completeJob, jobForCustomer, TransportError } from "~/lib/transport.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/transport.job";

export const meta: Route.MetaFunction = ({ data }) => [{ title: data ? `${data.job.number} · MyPlug` : "Transport request · MyPlug" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  const job = await jobForCustomer(user.id, params.id);
  if (!job) throw data("Request not found", { status: 404 });
  const [ratings, reviewable] = await Promise.all([
    courierRatings(job.offers.map((o) => o.courier.id)),
    job.status === "completed" ? reviewableTransport(user.id, { jobId: job.id }) : null,
  ]);
  return { job, ratings: Object.fromEntries(ratings), reviewable };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const form = await request.formData();
  try {
    const intent = form.get("intent");
    if (intent === "rate") {
      await submitTransportReview({ customerId: user.id, ref: { jobId: params.id }, rating: Number(form.get("rating")), comment: String(form.get("comment") ?? "") });
      return { ok: "Thanks for your rating!" };
    }
    if (intent === "accept") await acceptOffer(user.id, str(form.get("offerId")));
    else if (intent === "cancel") await cancelJob(user.id, params.id);
    else if (intent === "complete") await completeJob(params.id, { customerId: user.id });
    return { ok: true };
  } catch (e) {
    if (e instanceof TransportError || e instanceof ReviewError) return { error: e.message };
    throw e;
  }
}

export default function TransportJob({ loaderData, actionData }: Route.ComponentProps) {
  const { job, ratings, reviewable } = loaderData;
  const busy = useNavigation().state !== "idle";
  // New offers arrive while the customer waits.
  usePolling(job.status === "open" ? 15_000 : 5 * 60_000);
  const status = JOB_STATUS[job.status];

  return (
    <Container className="max-w-3xl py-8">
      <Link to="/account/transport" className="mb-3 block w-fit text-sm text-muted-foreground hover:text-primary">
        ← My transport
      </Link>
      <PageHeader
        title={`${TRANSPORT_LABEL[job.type]}: ${job.pickup}${job.dropoff ? ` → ${job.dropoff}` : ""}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {job.number} · posted {timeAgo(job.createdAt)} <Badge variant={status.tone}>{status.label}</Badge>
          </span>
        }
      />
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      {reviewable ? (
        <div className="mb-6">
          <RateCourier
            courierName={reviewable.courier.name}
            review={reviewable.review}
            result={actionData && "ok" in actionData && typeof actionData.ok === "string" ? { ok: actionData.ok } : null}
          />
        </div>
      ) : null}

      <Card className="mb-6">
        <CardContent className="grid gap-2 pt-5 text-sm">
          <p>
            <strong>When:</strong>{" "}
            {job.type === "car_hire" && job.when && job.untilDate
              ? `${date(job.when)} to ${date(job.untilDate)}`
              : job.when
                ? date(job.when, true)
                : "As soon as possible"}
          </p>
          {job.passengers ? (
            <p>
              <strong>Passengers:</strong> {job.passengers}
            </p>
          ) : null}
          {job.details ? <p className="whitespace-pre-line">{job.details}</p> : null}
          {job.budgetCents ? (
            <p>
              <strong>Your budget:</strong> {money(job.budgetCents)}
            </p>
          ) : null}
          {job.imageUrl ? <SafeImage src={job.imageUrl} alt="" className="max-h-64 w-fit rounded-xl" imgClassName="object-contain" /> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {job.status === "open" || job.status === "booked" ? (
              <Form method="post">
                <Button type="submit" name="intent" value="cancel" variant="ghost" size="sm" disabled={busy}>
                  Cancel request
                </Button>
              </Form>
            ) : null}
            {job.status === "booked" ? (
              <Form method="post">
                <Button type="submit" name="intent" value="complete" variant="outline" size="sm" disabled={busy}>
                  <CheckIcon /> Mark as done
                </Button>
              </Form>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{job.status === "open" ? "Offers" : "Your courier"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {job.offers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No offers yet. Couriers who offer {TRANSPORT_LABEL[job.type].toLowerCase()} have been told; this page updates by itself.
            </p>
          ) : null}
          {job.offers
            .filter((o) => job.status === "open" || o.status === "accepted")
            .map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
                <div className="grid flex-1 gap-0.5 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-bold">
                    {o.courier.name}
                    <RatingBadge average={ratings[o.courier.id]?.average} total={ratings[o.courier.id]?.total ?? 0} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[o.courier.vehicleType ?? o.courier.vehicle, o.courier.capacity, o.courier.plateNumber].filter(Boolean).join(" · ")}
                  </p>
                  {o.note ? <p className="text-muted-foreground">“{o.note}”</p> : null}
                  {o.courier.phone ? (
                    <a href={`tel:${o.courier.phone}`} className="flex w-fit items-center gap-1 font-semibold text-accent hover:underline">
                      <PhoneIcon className="size-4" /> {o.courier.phone}
                    </a>
                  ) : null}
                </div>
                <span className="text-xl font-black text-primary">{money(o.priceCents)}</span>
                {job.status === "open" ? (
                  <Form method="post">
                    <input type="hidden" name="offerId" value={o.id} />
                    <Button type="submit" name="intent" value="accept" disabled={busy}>
                      Accept
                    </Button>
                  </Form>
                ) : null}
              </div>
            ))}
          {job.status === "open" && job.offers.length ? (
            <p className="text-xs text-muted-foreground">
              Once you accept, you'll see the courier's phone number and they'll get yours. Agree the details and pay them directly, as agreed.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </Container>
  );
}
