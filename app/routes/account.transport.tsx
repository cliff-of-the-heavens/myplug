import { CarFrontIcon, PhoneIcon, TruckIcon } from "lucide-react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { Container, EmptyState, FormError, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { requireCustomer } from "~/lib/auth.server";
import { formatDay } from "~/lib/dates";
import { date, money, timeAgo } from "~/lib/format";
import { BOOKING_STATUS, JOB_STATUS, TRANSPORT_LABEL } from "~/lib/transport";
import { cancelBooking, customerBookings, customerJobs, TransportError } from "~/lib/transport.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/account.transport";

export const meta: Route.MetaFunction = () => [{ title: "My transport · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  const [jobs, bookings] = await Promise.all([customerJobs(user.id), customerBookings(user.id)]);
  return { jobs, bookings };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const form = await request.formData();
  try {
    await cancelBooking(user.id, str(form.get("bookingId")));
    return { ok: true };
  } catch (e) {
    if (e instanceof TransportError) return { error: e.message };
    throw e;
  }
}

export default function MyTransport({ loaderData, actionData }: Route.ComponentProps) {
  const { jobs, bookings } = loaderData;
  const [params] = useSearchParams();
  const busy = useNavigation().state !== "idle";
  return (
    <Container className="grid max-w-3xl gap-8 py-8">
      <PageHeader
        title="My transport"
        description="Rides, moves and deliveries you've requested, and your car hire bookings."
        actions={
          <Button asChild>
            <Link to="/transport/new">New request</Link>
          </Button>
        }
      />
      {params.get("booked") ? (
        <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">Booking requested. The owner will confirm it; you'll get a notification.</p>
      ) : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />

      <section className="grid gap-3">
        <h2 className="text-lg font-extrabold">Car hire</h2>
        {bookings.length ? (
          bookings.map((b) => (
            <Card key={b.id}>
              <CardContent className="flex flex-wrap items-center gap-3 pt-5 text-sm">
                <div className="grid flex-1 gap-0.5">
                  <Link to={`/transport/cars/${b.car.id}`} className="font-bold hover:text-primary">
                    {b.car.title}
                  </Link>
                  <p className="text-muted-foreground">
                    {formatDay(b.startDate)} to {formatDay(b.endDate)}
                    {b.withDriver ? " · with driver" : ""} · {b.car.owner} · {b.number}
                  </p>
                  {b.ownerPhone ? (
                    <a href={`tel:${b.ownerPhone}`} className="flex w-fit items-center gap-1 font-semibold text-accent hover:underline">
                      <PhoneIcon className="size-4" /> {b.ownerPhone}
                    </a>
                  ) : null}
                  {b.ownerNote ? <p className="text-xs">Owner: {b.ownerNote}</p> : null}
                </div>
                <span className="font-bold">{money(b.totalCents)}</span>
                <Badge variant={BOOKING_STATUS[b.status].tone}>{BOOKING_STATUS[b.status].label}</Badge>
                {b.status === "requested" || b.status === "confirmed" ? (
                  <Form method="post">
                    <input type="hidden" name="bookingId" value={b.id} />
                    <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                      Cancel
                    </Button>
                  </Form>
                ) : null}
              </CardContent>
            </Card>
          ))
        ) : (
          <EmptyState icon={CarFrontIcon} title="No car hire yet">
            <Link to="/transport#cars" className="font-semibold text-primary">
              Browse cars for hire
            </Link>
          </EmptyState>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-extrabold">Requests</h2>
        {jobs.length ? (
          jobs.map((j) => (
            <Link key={j.id} to={`/transport/jobs/${j.id}`} className="rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="accent">{TRANSPORT_LABEL[j.type]}</Badge>
                <span className="flex-1 font-bold">
                  {j.pickup}
                  {j.dropoff ? ` → ${j.dropoff}` : ""}
                </span>
                <Badge variant={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {j.number} · {j.when ? date(j.when, j.type !== "car_hire") : "as soon as possible"} · posted {timeAgo(j.createdAt)}
                {j.status === "open" ? ` · ${j.offers.filter((o) => o.status === "offered").length} offer(s)` : ""}
                {j.courier ? ` · ${j.courier.name}` : ""}
                {j.priceCents ? ` · ${money(j.priceCents)}` : ""}
              </p>
            </Link>
          ))
        ) : (
          <EmptyState icon={TruckIcon} title="No requests yet">
            Need a ride, a move or something delivered?{" "}
            <Link to="/transport/new" className="font-semibold text-primary">
              Post a request
            </Link>
          </EmptyState>
        )}
      </section>
    </Container>
  );
}
