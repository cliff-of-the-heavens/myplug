import { CarFrontIcon, PencilIcon, PhoneIcon, PlusIcon } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import { Container, EmptyState, FormError, PageHeader } from "~/components/page";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { requireCourier } from "~/lib/auth.server";
import { getCourier } from "~/lib/couriers.server";
import { formatDay } from "~/lib/dates";
import { money } from "~/lib/format";
import { BOOKING_STATUS } from "~/lib/transport";
import { bookingsForOwner, courierCars, respondToBooking, TransportError } from "~/lib/transport.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/courier.cars";

export const meta: Route.MetaFunction = () => [{ title: "Hire cars · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCourier(request);
  const [courier, cars, bookings] = await Promise.all([getCourier(user.courierId), courierCars(user.courierId), bookingsForOwner(user.courierId)]);
  return { offersCarHire: courier!.services.includes("car_hire"), cars, bookings };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCourier(request);
  const form = await request.formData();
  const action = str(form.get("action"));
  if (action !== "confirm" && action !== "decline" && action !== "complete") return { error: "Unknown action." };
  try {
    await respondToBooking(user.courierId, str(form.get("bookingId")), action, str(form.get("note")));
    return { ok: true };
  } catch (e) {
    if (e instanceof TransportError) return { error: e.message };
    throw e;
  }
}

export default function CourierCars({ loaderData, actionData }: Route.ComponentProps) {
  const { offersCarHire, cars, bookings } = loaderData;
  const busy = useNavigation().state !== "idle";
  return (
    <Container className="grid max-w-4xl gap-8 py-8">
      <PageHeader
        title="Hire cars"
        description="Cars you rent out by the day. Customers request dates; you confirm or decline."
        actions={
          <div className="flex flex-wrap gap-2">
            {offersCarHire ? (
              <Button asChild>
                <Link to="/courier/cars/new">
                  <PlusIcon /> Add a car
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link to="/courier/transport">Transport jobs</Link>
            </Button>
          </div>
        }
      />
      {!offersCarHire ? (
        <p className="rounded-xl bg-muted p-4 text-sm">
          <Link to="/courier/profile" className="font-semibold text-primary underline">
            Tick Car hire under your services
          </Link>{" "}
          to list cars.
        </p>
      ) : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />

      <section className="grid gap-3">
        <h2 className="text-lg font-extrabold">Bookings</h2>
        {bookings.length ? (
          bookings.map((b) => (
            <Card key={b.id}>
              <CardContent className="grid gap-2 pt-5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 font-bold">
                    {b.carTitle}: {formatDay(b.startDate)} to {formatDay(b.endDate)}
                    {b.withDriver ? " · with driver" : ""}
                  </span>
                  <span className="font-bold">{money(b.totalCents)}</span>
                  <Badge variant={BOOKING_STATUS[b.status].tone}>{BOOKING_STATUS[b.status].label}</Badge>
                </div>
                <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  {b.number} · {b.customerName}
                  <a href={`tel:${b.contactPhone}`} className="flex items-center gap-1 font-semibold text-accent hover:underline">
                    <PhoneIcon className="size-3.5" /> {b.contactPhone}
                  </a>
                </p>
                {b.note ? <p>“{b.note}”</p> : null}
                {b.status === "requested" || b.status === "confirmed" ? (
                  <Form method="post" className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="bookingId" value={b.id} />
                    {b.status === "requested" ? (
                      <>
                        <Button type="submit" name="action" value="confirm" size="sm" disabled={busy}>
                          Confirm
                        </Button>
                        <Input name="note" placeholder="Reason, if declining" className="h-8 w-48 text-xs" />
                        <Button type="submit" name="action" value="decline" size="sm" variant="ghost" disabled={busy}>
                          Decline
                        </Button>
                      </>
                    ) : (
                      <Button type="submit" name="action" value="complete" size="sm" variant="outline" disabled={busy}>
                        Car returned
                      </Button>
                    )}
                  </Form>
                ) : null}
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No bookings yet.</p>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-extrabold">Your cars</h2>
        {cars.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {cars.map((c) => (
              <Card key={c.id} className={c.isActive ? undefined : "opacity-60"}>
                <CardContent className="flex gap-3 pt-5">
                  <SafeImage src={c.imageUrl} alt="" className="size-20 shrink-0 rounded-lg" />
                  <div className="grid flex-1 content-start gap-0.5 text-sm">
                    <p className="font-bold">{c.title}</p>
                    <p className="text-muted-foreground">
                      {money(c.dailyCents)}/day{c.driverDailyCents != null ? ` · driver +${money(c.driverDailyCents)}` : ""}
                    </p>
                    {!c.isActive ? <Badge variant="muted">Hidden</Badge> : null}
                  </div>
                  <Button asChild variant="ghost" size="icon-sm" aria-label="Edit">
                    <Link to={`/courier/cars/${c.id}`}>
                      <PencilIcon />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState icon={CarFrontIcon} title="No cars listed">
            Add a car with photos and a daily price. Customers book it from the Transport page.
          </EmptyState>
        )}
      </section>
    </Container>
  );
}
