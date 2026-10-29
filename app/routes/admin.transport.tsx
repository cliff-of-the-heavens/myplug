import { CarFrontIcon, ClockIcon, PhoneIcon, TruckIcon } from "lucide-react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { EmptyState, FormError, PageHeader } from "~/components/page";
import { Stars } from "~/components/rating";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input, NativeSelect } from "~/components/ui/input";
import type { TransportJobStatus } from "~/db/schema";
import { requireAdmin } from "~/lib/auth.server";
import { formatDay } from "~/lib/dates";
import { date, money, timeAgo } from "~/lib/format";
import { BOOKING_STATUS, isTransportType, JOB_STATUS, TRANSPORT_LABEL, TRANSPORT_TYPES } from "~/lib/transport";
import {
  adminBookings,
  adminCancelBooking,
  adminCancelJob,
  adminCars,
  adminJobs,
  adminSetCarActive,
  transportStats,
  TransportError,
  UNANSWERED_HOURS,
} from "~/lib/transport.server";
import { cn, str } from "~/lib/utils";
import type { Route } from "./+types/admin.transport";

export const meta: Route.MetaFunction = () => [{ title: "Transport · Admin · MyPlug" }];

const STATUSES = Object.keys(JOB_STATUS) as TransportJobStatus[];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") === "cars" ? "cars" : "requests";
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status") as TransportJobStatus | null;
  const q = url.searchParams.get("q")?.trim().slice(0, 80) || undefined;
  const unanswered = url.searchParams.get("unanswered") === "1";
  const [stats, jobs, cars, bookings] = await Promise.all([
    transportStats(30),
    tab === "requests"
      ? adminJobs({ type: isTransportType(type) ? type : undefined, status: status && STATUSES.includes(status) ? status : undefined, q, unanswered })
      : [],
    tab === "cars" ? adminCars() : [],
    tab === "cars" ? adminBookings() : [],
  ]);
  return { tab, stats, jobs, cars, bookings, filter: { type: isTransportType(type) ? type : "", status: status ?? "", q: q ?? "", unanswered } };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const reason = str(form.get("reason"));
  try {
    switch (form.get("intent")) {
      case "cancel-job":
        await adminCancelJob(str(form.get("jobId")), reason);
        return { ok: "Request cancelled. The customer and any booked courier were told why." };
      case "car-active": {
        const active = form.get("active") === "1";
        await adminSetCarActive(str(form.get("carId")), active, reason);
        return { ok: active ? "Car shown to customers again." : "Car hidden. The owner was told why." };
      }
      case "cancel-booking":
        await adminCancelBooking(str(form.get("bookingId")), reason);
        return { ok: "Booking cancelled. The customer and the owner were told why." };
      default:
        return { error: "Unknown action." };
    }
  } catch (e) {
    if (e instanceof TransportError) return { error: e.message };
    throw e;
  }
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" }) {
  return (
    <div className={cn("rounded-2xl border bg-card p-4", tone === "warning" && value > 0 && "border-warning bg-warning/10")}>
      <p className="text-2xl font-black">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export default function AdminTransport({ loaderData, actionData }: Route.ComponentProps) {
  const { tab, stats, filter } = loaderData;
  const [params] = useSearchParams();
  const tabHref = (t: string) => `?${new URLSearchParams({ tab: t })}`;
  return (
    <div className="grid gap-6">
      <PageHeader title="Transport" description="Rides, moves, parcels and car hire between customers and couriers. Step in on fake requests, disputes and misleading cars." />
      {actionData && "ok" in actionData ? <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Last {stats.days} days</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Requests posted" value={stats.total} />
          <Stat label="Booked or done" value={stats.booked + stats.completed} />
          <Stat label="Cancelled" value={stats.cancelled} />
          <Link to={`?${new URLSearchParams({ tab: "requests", unanswered: "1" })}`}>
            <Stat label={`Waiting over ${UNANSWERED_HOURS}h with no offers (now)`} value={stats.unanswered} tone="warning" />
          </Link>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {TRANSPORT_TYPES.map((t) => `${t.short}: ${stats.types[t.value]}`).join(" · ")} · Car hire bookings: {stats.carBookings} ({stats.carConfirmed} confirmed)
        </p>
      </div>

      <div className="flex gap-2 border-b pb-3">
        {(
          [
            ["requests", "Requests"],
            ["cars", "Car hire"],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            to={tabHref(value)}
            className={cn("rounded-full px-4 py-1.5 text-sm font-semibold", tab === value ? "bg-foreground text-background" : "bg-muted hover:bg-muted/70")}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "requests" ? (
        <>
          <Form className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="tab" value="requests" />
            <NativeSelect name="type" defaultValue={filter.type} className="h-9 w-auto" aria-label="Type">
              <option value="">All types</option>
              {TRANSPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.short}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect name="status" defaultValue={filter.status} className="h-9 w-auto" aria-label="Status">
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {JOB_STATUS[s].label}
                </option>
              ))}
            </NativeSelect>
            <Input name="q" type="search" defaultValue={filter.q} placeholder="TR-…, customer or courier" className="h-9 w-56" />
            {filter.unanswered ? <input type="hidden" name="unanswered" value="1" /> : null}
            <Button type="submit" size="sm" variant="secondary">
              Filter
            </Button>
            {params.toString() && params.toString() !== "tab=requests" ? (
              <Link to="?tab=requests" className="text-sm text-muted-foreground hover:text-primary">
                Clear
              </Link>
            ) : null}
            {filter.unanswered ? <Badge variant="warning">Only unanswered</Badge> : null}
          </Form>
          <JobList jobs={loaderData.jobs} />
        </>
      ) : (
        <CarHire cars={loaderData.cars} bookings={loaderData.bookings} />
      )}
    </div>
  );
}

function JobList({ jobs }: { jobs: Route.ComponentProps["loaderData"]["jobs"] }) {
  const busy = useNavigation().state !== "idle";
  if (!jobs.length) return <EmptyState icon={TruckIcon} title="No requests here">Try another filter.</EmptyState>;
  return (
    <div className="grid gap-2">
      {jobs.map((j) => {
        const live = j.offers.filter((o) => o.status !== "withdrawn");
        return (
          <details key={j.id} className="rounded-2xl border bg-card">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-4 text-sm">
              <Badge variant="accent">{TRANSPORT_LABEL[j.type]}</Badge>
              <span className="min-w-48 flex-1 font-bold">
                {j.pickup}
                {j.dropoff ? ` → ${j.dropoff}` : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {j.number} · {j.customer.name} · {live.length} offer{live.length === 1 ? "" : "s"}
                {j.courier ? ` · ${j.courier.name}` : ""}
                {j.priceCents ? ` · ${money(j.priceCents)}` : ""}
              </span>
              {j.review ? <Stars value={j.review.rating} size="size-3.5" /> : null}
              <Badge variant={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge>
            </summary>
            <div className="grid gap-3 border-t p-4 text-sm">
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ClockIcon className="size-4" />
                  {j.type === "car_hire" && j.when && j.untilDate ? `${date(j.when)} to ${date(j.untilDate)}` : j.when ? date(j.when, true) : "As soon as possible"}
                </span>
                <span>posted {timeAgo(j.createdAt)}</span>
                {j.passengers ? <span>{j.passengers} passenger(s)</span> : null}
                {j.budgetCents ? <span>budget {money(j.budgetCents)}</span> : null}
              </p>
              {j.details ? <p className="whitespace-pre-line">{j.details}</p> : null}
              {j.imageUrl ? <SafeImage src={j.imageUrl} alt="" className="max-h-48 w-fit rounded-xl" imgClassName="object-contain" /> : null}
              <p className="flex flex-wrap items-center gap-3">
                <span>
                  Customer:{" "}
                  <Link to={`/admin/users/${j.customer.id}`} className="font-semibold hover:underline">
                    {j.customer.name}
                  </Link>{" "}
                  ({j.customer.email})
                </span>
                <a href={`tel:${j.contactPhone}`} className="flex items-center gap-1 font-semibold text-accent hover:underline">
                  <PhoneIcon className="size-3.5" /> {j.contactPhone}
                </a>
              </p>
              {j.offers.length ? (
                <ul className="grid gap-1">
                  {j.offers.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                      <Link to={`/admin/couriers?${new URLSearchParams({ q: o.courier.name })}`} className="font-semibold hover:underline">
                        {o.courier.name}
                      </Link>
                      <span className="text-muted-foreground">{o.courier.phone}</span>
                      <span className="flex-1 text-muted-foreground">{o.note ? `“${o.note}”` : ""}</span>
                      <span className="font-bold">{money(o.priceCents)}</span>
                      <Badge variant={o.status === "accepted" ? "success" : "muted"} className="capitalize">
                        {o.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No offers.</p>
              )}
              {j.review ? (
                <p>
                  Customer's rating: <Stars value={j.review.rating} size="size-3.5" /> {j.review.comment ? `“${j.review.comment}”` : ""}
                </p>
              ) : null}
              {j.status === "open" || j.status === "booked" ? (
                <Form method="post" className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="intent" value="cancel-job" />
                  <input type="hidden" name="jobId" value={j.id} />
                  <Input name="reason" required minLength={3} placeholder="Reason (sent to the people involved)" className="h-8 min-w-64 flex-1 text-xs" />
                  <Button type="submit" size="sm" variant="destructive" disabled={busy}>
                    Cancel request
                  </Button>
                </Form>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function CarHire({ cars, bookings }: { cars: Route.ComponentProps["loaderData"]["cars"]; bookings: Route.ComponentProps["loaderData"]["bookings"] }) {
  const busy = useNavigation().state !== "idle";
  return (
    <>
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
                <p className="flex flex-wrap items-center gap-x-3 text-muted-foreground">
                  <span>{b.number}</span>
                  <span>
                    Customer:{" "}
                    <Link to={`/admin/users/${b.customerId}`} className="font-semibold text-foreground hover:underline">
                      {b.customerName}
                    </Link>{" "}
                    {b.contactPhone}
                  </span>
                  <span>
                    Owner:{" "}
                    <Link to={`/admin/couriers?${new URLSearchParams({ q: b.courierName })}`} className="font-semibold text-foreground hover:underline">
                      {b.courierName}
                    </Link>{" "}
                    {b.courierPhone}
                  </span>
                </p>
                {b.note ? <p>“{b.note}”</p> : null}
                {b.status === "requested" || b.status === "confirmed" ? (
                  <Form method="post" className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="intent" value="cancel-booking" />
                    <input type="hidden" name="bookingId" value={b.id} />
                    <Input name="reason" required minLength={3} placeholder="Reason (sent to both sides)" className="h-8 min-w-64 flex-1 text-xs" />
                    <Button type="submit" size="sm" variant="destructive" disabled={busy}>
                      Cancel booking
                    </Button>
                  </Form>
                ) : null}
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No bookings in the last 60 days or coming up.</p>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-extrabold">Cars</h2>
        {cars.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {cars.map((c) => (
              <Card key={c.id} className={c.isActive ? undefined : "opacity-70"}>
                <CardContent className="grid gap-2 pt-5 text-sm">
                  <div className="flex gap-3">
                    <SafeImage src={c.imageUrl} alt="" className="size-16 shrink-0 rounded-lg" />
                    <div className="grid flex-1 content-start gap-0.5">
                      <p className="flex flex-wrap items-center gap-2 font-bold">
                        {c.isActive ? (
                          <Link to={`/transport/cars/${c.id}`} className="hover:underline">
                            {c.title}
                          </Link>
                        ) : (
                          c.title
                        )}
                        {!c.isActive ? <Badge variant="muted">Hidden</Badge> : null}
                      </p>
                      <p className="text-muted-foreground">
                        {money(c.dailyCents)}/day{c.driverDailyCents != null ? ` · driver +${money(c.driverDailyCents)}` : ""} · {c.seats} seats · {c.location}
                      </p>
                      <p className="text-muted-foreground">
                        Owner:{" "}
                        <Link to={`/admin/couriers?${new URLSearchParams({ q: c.courierName })}`} className="font-semibold text-foreground hover:underline">
                          {c.courierName}
                        </Link>{" "}
                        · {c.bookings} booking{c.bookings === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <Form method="post" className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="intent" value="car-active" />
                    <input type="hidden" name="carId" value={c.id} />
                    <input type="hidden" name="active" value={c.isActive ? "0" : "1"} />
                    <Input name="reason" required={c.isActive} minLength={c.isActive ? 3 : undefined} placeholder={c.isActive ? "Reason (sent to the owner)" : "Note to the owner (optional)"} className="h-8 min-w-48 flex-1 text-xs" />
                    <Button type="submit" size="sm" variant={c.isActive ? "destructive" : "outline"} disabled={busy}>
                      {c.isActive ? "Hide car" : "Show again"}
                    </Button>
                  </Form>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState icon={CarFrontIcon} title="No hire cars yet">
            Couriers who offer car hire add them from their dashboard.
          </EmptyState>
        )}
      </section>
    </>
  );
}
