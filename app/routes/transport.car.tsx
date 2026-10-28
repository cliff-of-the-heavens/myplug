import { useState } from "react";
import { MapPinIcon, UsersIcon } from "lucide-react";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import { AuthLink } from "~/components/auth-dialog";
import { Container, FormError } from "~/components/page";
import { SafeImage } from "~/components/safe-image";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Field, Input, Textarea } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { eq } from "drizzle-orm";
import { getUser, requireCustomer } from "~/lib/auth.server";
import { formatDay, today } from "~/lib/dates";
import { money } from "~/lib/format";
import { daysBetween } from "~/lib/transport";
import { bookCar, carDetail, TransportError } from "~/lib/transport.server";
import { cn, str } from "~/lib/utils";
import type { Route } from "./+types/transport.car";

export const meta: Route.MetaFunction = ({ data }) => [{ title: data ? `${data.car.title} for hire · MyPlug` : "Car hire · MyPlug" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const detail = await carDetail(params.id);
  if (!detail) throw data("Car not found", { status: 404 });
  const user = await getUser(request);
  const me = user ? await db.query.users.findFirst({ where: eq(schema.users.id, user.id), columns: { phone: true } }) : null;
  return { ...detail, today: today(), viewer: user?.role ?? null, phone: me?.phone ?? "" };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const form = await request.formData();
  try {
    await bookCar(user.id, params.id, {
      startDate: str(form.get("startDate")),
      endDate: str(form.get("endDate")),
      withDriver: form.get("withDriver") === "1",
      note: str(form.get("note")),
      contactPhone: str(form.get("contactPhone")),
    });
  } catch (e) {
    if (e instanceof TransportError) return { error: e.message };
    throw e;
  }
  return redirect("/account/transport?booked=1");
}

export default function HireCar({ loaderData, actionData }: Route.ComponentProps) {
  const { car, taken, viewer } = loaderData;
  const busy = useNavigation().state !== "idle";
  const photos = [car.imageUrl, ...car.images].filter((u): u is string => !!u);
  const [photo, setPhoto] = useState(photos[0] ?? null);
  const [range, setRange] = useState({ start: "", end: "" });
  const [withDriver, setWithDriver] = useState(!car.selfDrive);
  const days = range.start && range.end && range.end >= range.start ? daysBetween(range.start, range.end) : 0;
  const perDay = car.dailyCents + (withDriver ? (car.driverDailyCents ?? 0) : 0);

  return (
    <Container className="grid gap-8 py-8 md:grid-cols-2">
      <div className="grid content-start gap-2">
        <Link to="/transport#cars" className="mb-1 w-fit text-sm text-muted-foreground hover:text-primary">
          ← Cars for hire
        </Link>
        <SafeImage src={photo} alt={car.title} className="aspect-[4/3] rounded-2xl border" />
        {photos.length > 1 ? (
          <div className="scrollbar-none flex gap-2 overflow-x-auto">
            {photos.map((url) => (
              <button key={url} type="button" onClick={() => setPhoto(url)} className={cn("size-16 shrink-0 overflow-hidden rounded-lg border-2", photo === url ? "border-primary" : "border-transparent")}>
                <img src={url} alt="" className="size-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid content-start gap-5">
        <div className="grid gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{car.title}</h1>
          <p className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <UsersIcon className="size-4" /> {car.seats} seats
            </span>
            {car.transmission ? <span className="capitalize">{car.transmission}</span> : null}
            <span className="flex items-center gap-1">
              <MapPinIcon className="size-4" /> Collect at {car.location}
            </span>
          </p>
          <p className="text-sm">Owner: {car.courier.name} (registered, ID-checked courier)</p>
        </div>
        <div className="grid gap-1">
          {car.selfDrive ? (
            <p>
              <span className="text-3xl font-black text-primary">{money(car.dailyCents)}</span> <span className="text-sm text-muted-foreground">per day, self-drive</span>
            </p>
          ) : null}
          {car.driverDailyCents != null ? (
            <p className={car.selfDrive ? "text-sm" : ""}>
              {car.selfDrive ? "With a driver: " : null}
              <span className={car.selfDrive ? "font-bold" : "text-3xl font-black text-primary"}>{money(car.dailyCents + car.driverDailyCents)}</span>{" "}
              <span className="text-sm text-muted-foreground">per day{car.selfDrive ? "" : ", with a driver"}</span>
            </p>
          ) : null}
        </div>
        {car.description ? <p className="whitespace-pre-line text-muted-foreground">{car.description}</p> : null}
        {taken.length ? (
          <div className="text-sm">
            <p className="font-semibold">Already booked</p>
            <ul className="text-muted-foreground">
              {taken.map((t) => (
                <li key={`${t.startDate}-${t.endDate}`}>
                  {formatDay(t.startDate)} to {formatDay(t.endDate)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Card>
          <CardContent className="pt-5">
            {viewer === "customer" ? (
              <Form method="post" className="grid gap-4">
                <FormError error={actionData?.error} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="First day">
                    <Input name="startDate" type="date" min={loaderData.today} required value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} />
                  </Field>
                  <Field label="Last day">
                    <Input name="endDate" type="date" min={range.start || loaderData.today} required value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} />
                  </Field>
                </div>
                {car.selfDrive && car.driverDailyCents != null ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="withDriver" value="1" checked={withDriver} onChange={(e) => setWithDriver(e.target.checked)} className="size-4 accent-primary" />
                    With a driver (+{money(car.driverDailyCents)} per day)
                  </label>
                ) : !car.selfDrive ? (
                  <input type="hidden" name="withDriver" value="1" />
                ) : null}
                <Field label="Phone number" hint="Shared with the owner">
                  <Input name="contactPhone" type="tel" required defaultValue={loaderData.phone} />
                </Field>
                <Field label="Message to the owner (optional)">
                  <Textarea name="note" rows={2} className="min-h-0" placeholder="e.g. Trip to Mangochi; I'll collect at 8am" />
                </Field>
                {days ? (
                  <p className="text-sm">
                    {days} day{days === 1 ? "" : "s"} × {money(perDay)} = <strong className="text-lg text-primary">{money(days * perDay)}</strong>
                  </p>
                ) : null}
                <Button type="submit" size="lg" disabled={busy}>
                  {busy ? "Sending..." : "Request booking"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  The owner confirms the booking and you agree how to pay, any deposit and the driving licence they need to see.
                </p>
              </Form>
            ) : viewer ? (
              <p className="text-sm text-muted-foreground">Sign in with a customer account to book this car.</p>
            ) : (
              <Button asChild size="lg" className="w-full">
                <AuthLink mode="login">Sign in to book</AuthLink>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}
