import { CarFrontIcon, CarTaxiFrontIcon, PackageIcon, SearchXIcon, TruckIcon, UsersIcon } from "lucide-react";
import { Form, Link } from "react-router";
import { Container, EmptyState, PageHeader } from "~/components/page";
import { RatingBadge } from "~/components/rating";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input, NativeSelect } from "~/components/ui/input";
import type { TransportType } from "~/db/schema";
import { money } from "~/lib/format";
import { TRANSPORT_TYPES } from "~/lib/transport";
import { listCars } from "~/lib/transport.server";
import type { Route } from "./+types/transport";

export const meta: Route.MetaFunction = () => [{ title: "Transport, moving & car hire · MyPlug" }];

const ICON: Record<TransportType, typeof TruckIcon> = { taxi: CarTaxiFrontIcon, moving: TruckIcon, parcel: PackageIcon, car_hire: CarFrontIcon };

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 80) || undefined;
  const seats = Number(url.searchParams.get("seats")) || undefined;
  const driver = url.searchParams.get("driver") === "1";
  return { cars: await listCars({ q, seats, driver }), q: q ?? "", seats: seats ?? 0, driver };
}

export default function Transport({ loaderData }: Route.ComponentProps) {
  const { cars, q, seats, driver } = loaderData;
  return (
    <Container className="grid gap-8 py-8">
      <PageHeader
        title="Transport, moving & car hire"
        description="Registered, ID-checked couriers and drivers. Post what you need and they send you their prices, or book a hire car for your dates."
        actions={
          <Button asChild variant="outline">
            <Link to="/account/transport">My bookings</Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TRANSPORT_TYPES.map((t) => {
          const Icon = ICON[t.value];
          return (
            <Link
              key={t.value}
              to={t.value === "car_hire" ? "#cars" : `/transport/new?type=${t.value}`}
              className="group grid gap-2 rounded-2xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-6" />
              </span>
              <span className="font-bold group-hover:text-primary">{t.label}</span>
              <span className="text-sm text-muted-foreground">{t.hint}</span>
            </Link>
          );
        })}
      </div>

      <section id="cars" className="grid scroll-mt-32 gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold">Cars for hire</h2>
            <p className="text-sm text-muted-foreground">Book your dates; the owner confirms. Can't find the right car? Post a request and owners will offer theirs.</p>
          </div>
          <Button asChild variant="outline">
            <Link to="/transport/new?type=car_hire">Post a car hire request</Link>
          </Button>
        </div>
        <Form className="flex flex-wrap items-center gap-3" preventScrollReset>
          <Input name="q" type="search" defaultValue={q} placeholder="Make, model or town" className="w-56" />
          <NativeSelect name="seats" defaultValue={seats ? String(seats) : ""} className="w-auto" aria-label="Seats">
            <option value="">Any seats</option>
            {[4, 5, 7, 14].map((n) => (
              <option key={n} value={n}>
                {n}+ seats
              </option>
            ))}
          </NativeSelect>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="driver" value="1" defaultChecked={driver} className="size-4 accent-primary" />
            With a driver
          </label>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </Form>
        {cars.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cars.map((c) => (
              <Link
                key={c.id}
                to={`/transport/cars/${c.id}`}
                className="group overflow-hidden rounded-2xl border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
              >
                <SafeImage src={c.imageUrl} alt={c.title} className="aspect-[4/3]" />
                <div className="grid gap-1.5 p-4">
                  <p className="font-bold group-hover:text-primary">{c.title}</p>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <UsersIcon className="size-3.5" /> {c.seats} seats
                    </span>
                    {c.transmission ? <span className="capitalize">{c.transmission}</span> : null}
                    <span>{c.location}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-black text-primary">{money(c.dailyCents)}</span>
                    <span className="text-xs text-muted-foreground">per day</span>
                    {c.driverDailyCents != null ? <Badge variant="accent">Driver available</Badge> : null}
                    {!c.selfDrive ? <Badge variant="muted">With driver only</Badge> : null}
                  </p>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    by {c.courier.name}
                    <RatingBadge average={c.ownerRating?.average} total={c.ownerRating?.total ?? 0} />
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState icon={SearchXIcon} title="No cars found">
            <Link to="/transport/new?type=car_hire" className="font-semibold text-primary">
              Post a car hire request
            </Link>{" "}
            and owners will offer you a car.
          </EmptyState>
        )}
      </section>
    </Container>
  );
}
