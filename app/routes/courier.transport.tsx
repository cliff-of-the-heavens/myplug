import { TruckIcon } from "lucide-react";
import { Link } from "react-router";
import { Container, EmptyState, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { requireCourier } from "~/lib/auth.server";
import { getCourier } from "~/lib/couriers.server";
import { date, money, timeAgo } from "~/lib/format";
import { usePolling } from "~/lib/hooks";
import { JOB_STATUS, TRANSPORT_LABEL } from "~/lib/transport";
import { bookedJobsFor, openJobsFor } from "~/lib/transport.server";
import type { Route } from "./+types/courier.transport";

export const meta: Route.MetaFunction = () => [{ title: "Transport jobs · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCourier(request);
  const [courier, open, booked] = await Promise.all([getCourier(user.courierId), openJobsFor(user.courierId), bookedJobsFor(user.courierId)]);
  return { services: courier!.services, approved: courier!.status === "approved", open, booked };
}

export default function CourierTransport({ loaderData }: Route.ComponentProps) {
  const { services, approved, open, booked } = loaderData;
  usePolling(30_000);
  return (
    <Container className="grid max-w-4xl gap-8 py-8">
      <PageHeader
        title="Transport jobs"
        description="Rides, moves, parcels and car hire requests from customers, for the services you offer. Send your price; the customer chooses."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/courier/cars">Hire cars</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/courier">Dashboard</Link>
            </Button>
          </div>
        }
      />
      {!services.length ? (
        <p className="rounded-xl bg-muted p-4 text-sm">
          You haven't chosen any services yet.{" "}
          <Link to="/courier/profile" className="font-semibold text-primary underline">
            Tick taxi, moving, parcels or car hire on your profile
          </Link>{" "}
          to see customers' requests.
        </p>
      ) : !approved ? (
        <p className="rounded-xl bg-muted p-4 text-sm">Your account must be approved before you can send prices.</p>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-lg font-extrabold">Booked</h2>
        {booked.length ? (
          booked.map((j) => (
            <Link key={j.id} to={`/courier/transport/${j.id}`} className="rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="accent">{TRANSPORT_LABEL[j.type]}</Badge>
                <span className="flex-1 font-bold">
                  {j.pickup}
                  {j.dropoff ? ` → ${j.dropoff}` : ""}
                </span>
                {j.priceCents ? <span className="font-bold">{money(j.priceCents)}</span> : null}
                <Badge variant={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {j.number} · {j.customer.name} · {j.when ? date(j.when, j.type !== "car_hire") : "as soon as possible"}
              </p>
            </Link>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No bookings yet.</p>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-extrabold">Open requests</h2>
        {open.length ? (
          open.map((j) => (
            <Link key={j.id} to={`/courier/transport/${j.id}`} className="rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="accent">{TRANSPORT_LABEL[j.type]}</Badge>
                <span className="flex-1 font-bold">
                  {j.pickup}
                  {j.dropoff ? ` → ${j.dropoff}` : ""}
                </span>
                {j.myOffer && j.myOffer.status === "offered" ? <Badge variant="success">You offered {money(j.myOffer.priceCents)}</Badge> : null}
                {j.budgetCents ? <Badge variant="highlight">Budget {money(j.budgetCents)}</Badge> : null}
              </div>
              <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                {j.when ? date(j.when, j.type !== "car_hire") : "As soon as possible"} · posted {timeAgo(j.createdAt)}
                {j.details ? ` · ${j.details}` : ""}
              </p>
            </Link>
          ))
        ) : (
          <EmptyState icon={TruckIcon} title="No open requests">
            You'll get a notification when a customer posts one for your services.
          </EmptyState>
        )}
      </section>
    </Container>
  );
}
