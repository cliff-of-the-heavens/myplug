import { and, arrayContains, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { qualified } from "~/db/sql";
import type { TransportJobStatus, TransportType } from "~/db/schema";
import { isDateStr, today } from "./dates";
import { notify } from "./notify.server";
import { referenceNumber } from "./orders.server";
import { courierRatings } from "./reviews.server";
import { daysBetween, TRANSPORT_LABEL, UNANSWERED_HOURS } from "./transport";

const { transportJobs, transportOffers, hireCars, carBookings, couriers } = schema;

export class TransportError extends Error {}

const PHONE = /^\+?[\d\s-]{7,}$/;

// ---------------------------------------------------------------- requests and offers

export type JobInput = {
  type: TransportType;
  pickup: string;
  dropoff: string;
  when: Date | null; // null = as soon as possible
  untilDate: string | null;
  passengers: number | null;
  details: string;
  budgetCents: number | null;
  contactPhone: string;
  imageUrl: string | null;
};

/** A customer's request; every approved courier offering that service is told about it. */
export async function createJob(customerId: string, input: JobInput) {
  if (input.pickup.length < 3) throw new TransportError(input.type === "car_hire" ? "Say where you'd like to collect the car." : "Enter the pickup place.");
  if (input.type !== "car_hire" && input.dropoff.length < 3) throw new TransportError("Enter where it's going.");
  if (!PHONE.test(input.contactPhone)) throw new TransportError("Enter a phone number the courier can call.");
  if (input.when && input.when.getTime() < Date.now() - 60 * 60 * 1000) throw new TransportError("Choose a time in the future.");
  if (input.type === "car_hire") {
    if (!input.when || !input.untilDate) throw new TransportError("Choose the first and last day you need the car.");
    if (input.untilDate < input.when.toISOString().slice(0, 10)) throw new TransportError("The last day can't be before the first day.");
  }
  if ((input.type === "moving" || input.type === "parcel") && input.details.length < 5) {
    throw new TransportError(input.type === "moving" ? "Describe what's moving (e.g. 2-bedroom house, fridge, beds)." : "Say what you're sending.");
  }

  const [job] = await db
    .insert(transportJobs)
    .values({
      number: referenceNumber("TR"),
      customerId,
      type: input.type,
      pickup: input.pickup.slice(0, 200),
      dropoff: input.type === "car_hire" ? null : input.dropoff.slice(0, 200),
      when: input.when,
      untilDate: input.type === "car_hire" ? input.untilDate : null,
      passengers: input.passengers,
      details: input.details.slice(0, 2000),
      budgetCents: input.budgetCents,
      contactPhone: input.contactPhone.slice(0, 30),
      imageUrl: input.imageUrl,
    })
    .returning();

  const providers = await db
    .select({ userId: couriers.userId })
    .from(couriers)
    .where(and(eq(couriers.status, "approved"), arrayContains(couriers.services, [input.type])));
  await notify(
    providers.map((p) => p.userId),
    { title: `New ${TRANSPORT_LABEL[input.type].toLowerCase()} request: ${job.pickup}${job.dropoff ? ` → ${job.dropoff}` : ""}`, body: "Send your price.", href: `/courier/transport/${job.id}` },
    { email: input.type !== "taxi" }, // a ride is too urgent for email
  );
  return job;
}

/** A customer's request with the offers on it. The courier's phone is only shared once booked. */
export async function jobForCustomer(customerId: string, jobId: string) {
  const job = await db.query.transportJobs.findFirst({
    where: and(eq(transportJobs.id, jobId), eq(transportJobs.customerId, customerId)),
    with: {
      offers: {
        where: ne(transportOffers.status, "withdrawn"),
        orderBy: asc(transportOffers.priceCents),
        with: { courier: { columns: { id: true, name: true, phone: true, vehicle: true, vehicleType: true, capacity: true, plateNumber: true } } },
      },
    },
  });
  if (!job) return null;
  return {
    ...job,
    offers: job.offers.map((o) => ({
      ...o,
      courier: { ...o.courier, phone: o.status === "accepted" ? o.courier.phone : null, plateNumber: o.status === "accepted" ? o.courier.plateNumber : null },
    })),
  };
}

export function customerJobs(customerId: string) {
  return db.query.transportJobs.findMany({
    where: eq(transportJobs.customerId, customerId),
    orderBy: desc(transportJobs.createdAt),
    limit: 50,
    with: { offers: { columns: { id: true, status: true } }, courier: { columns: { name: true } } },
  });
}

async function approvedCourier(courierId: string) {
  const c = await db.query.couriers.findFirst({ where: eq(couriers.id, courierId) });
  if (!c || c.status !== "approved") throw new TransportError("Your account must be approved before you can take jobs.");
  return c;
}

/** A courier sends (or changes) their price for an open request. */
export async function makeOffer(courierId: string, jobId: string, priceCents: number | null, note: string) {
  const courier = await approvedCourier(courierId);
  const job = await db.query.transportJobs.findFirst({ where: eq(transportJobs.id, jobId) });
  if (!job || job.status !== "open") throw new TransportError("This request is no longer open.");
  if (!courier.services.includes(job.type)) throw new TransportError(`Add ${TRANSPORT_LABEL[job.type].toLowerCase()} to your services on your profile first.`);
  if (!priceCents || priceCents <= 0) throw new TransportError("Enter your price.");
  const existing = await db.query.transportOffers.findFirst({ where: and(eq(transportOffers.jobId, jobId), eq(transportOffers.courierId, courierId)) });
  if (existing) {
    await db.update(transportOffers).set({ priceCents, note: note.slice(0, 500) || null, status: "offered" }).where(eq(transportOffers.id, existing.id));
  } else {
    await db.insert(transportOffers).values({ jobId, courierId, priceCents, note: note.slice(0, 500) || null });
  }
  await notify([job.customerId], { title: `${courier.name} sent a price for your ${TRANSPORT_LABEL[job.type].toLowerCase()} request`, href: `/transport/jobs/${job.id}` });
}

export async function withdrawOffer(courierId: string, jobId: string) {
  await db
    .update(transportOffers)
    .set({ status: "withdrawn" })
    .where(and(eq(transportOffers.jobId, jobId), eq(transportOffers.courierId, courierId), eq(transportOffers.status, "offered")));
}

/** The customer picks an offer: the job is booked and both sides get each other's phone number. */
export async function acceptOffer(customerId: string, offerId: string) {
  const offer = await db.query.transportOffers.findFirst({ where: eq(transportOffers.id, offerId), with: { job: true, courier: true } });
  if (!offer || offer.job.customerId !== customerId) throw new TransportError("Offer not found.");
  if (offer.job.status !== "open" || offer.status !== "offered") throw new TransportError("This offer can't be accepted any more.");
  await db.transaction(async (tx) => {
    await tx.update(transportOffers).set({ status: "accepted" }).where(eq(transportOffers.id, offer.id));
    await tx.update(transportOffers).set({ status: "declined" }).where(and(eq(transportOffers.jobId, offer.jobId), ne(transportOffers.id, offer.id), eq(transportOffers.status, "offered")));
    await tx
      .update(transportJobs)
      .set({ status: "booked", courierId: offer.courierId, priceCents: offer.priceCents, bookedAt: new Date() })
      .where(eq(transportJobs.id, offer.jobId));
  });
  await notify([offer.courier.userId], { title: `You're booked: ${offer.job.number}`, body: `Call the customer on ${offer.job.contactPhone}.`, href: `/courier/transport/${offer.jobId}` }, { email: true });
  const others = await db
    .select({ userId: couriers.userId })
    .from(transportOffers)
    .innerJoin(couriers, eq(couriers.id, transportOffers.courierId))
    .where(and(eq(transportOffers.jobId, offer.jobId), eq(transportOffers.status, "declined")));
  await notify(others.map((o) => o.userId), { title: `The customer chose another courier for ${offer.job.number}` });
}

export async function cancelJob(customerId: string, jobId: string) {
  const job = await db.query.transportJobs.findFirst({ where: and(eq(transportJobs.id, jobId), eq(transportJobs.customerId, customerId)), with: { courier: true } });
  if (!job || (job.status !== "open" && job.status !== "booked")) throw new TransportError("This request can't be cancelled.");
  await db.update(transportJobs).set({ status: "cancelled" }).where(eq(transportJobs.id, job.id));
  if (job.courier) await notify([job.courier.userId], { title: `${job.number} was cancelled by the customer`, href: `/courier/transport/${job.id}` }, { email: true });
}

/** The booked courier, or the customer, marks the job done. */
export async function completeJob(jobId: string, by: { customerId: string } | { courierId: string }) {
  const job = await db.query.transportJobs.findFirst({ where: eq(transportJobs.id, jobId) });
  const mine = job && ("customerId" in by ? job.customerId === by.customerId : job.courierId === by.courierId);
  if (!job || !mine || job.status !== "booked") throw new TransportError("This job can't be marked as done.");
  await db.update(transportJobs).set({ status: "completed", completedAt: new Date() }).where(eq(transportJobs.id, job.id));
}

/** Open requests for the services a courier offers, newest first, with the courier's own offer. */
export async function openJobsFor(courierId: string) {
  const courier = await db.query.couriers.findFirst({ where: eq(couriers.id, courierId), columns: { services: true } });
  if (!courier?.services.length) return [];
  const jobs = await db.query.transportJobs.findMany({
    where: and(eq(transportJobs.status, "open"), inArray(transportJobs.type, courier.services as TransportType[])),
    orderBy: desc(transportJobs.createdAt),
    limit: 60,
    columns: { contactPhone: false },
    with: { offers: { where: eq(transportOffers.courierId, courierId) } },
  });
  return jobs.map(({ offers, ...j }) => ({ ...j, myOffer: offers[0] ?? null }));
}

/** Jobs the courier was booked for (with the customer's phone). */
export function bookedJobsFor(courierId: string) {
  return db.query.transportJobs.findMany({
    where: and(eq(transportJobs.courierId, courierId), inArray(transportJobs.status, ["booked", "completed", "cancelled"])),
    orderBy: desc(transportJobs.bookedAt),
    limit: 60,
    with: { customer: { columns: { name: true } } },
  });
}

/** One request as a courier sees it: contact details only once they're booked on it. */
export async function jobForCourier(courierId: string, jobId: string) {
  const job = await db.query.transportJobs.findFirst({
    where: eq(transportJobs.id, jobId),
    with: { customer: { columns: { name: true } }, offers: { where: eq(transportOffers.courierId, courierId) } },
  });
  if (!job) return null;
  const booked = job.courierId === courierId;
  if (job.status !== "open" && !booked) return null;
  const { offers, contactPhone, ...rest } = job;
  return { ...rest, contactPhone: booked ? contactPhone : null, customerName: booked ? job.customer.name : job.customer.name.split(" ")[0], myOffer: offers[0] ?? null, booked };
}

// ---------------------------------------------------------------- hire cars

export type CarInput = {
  title: string;
  description: string;
  seats: number;
  transmission: string | null;
  dailyCents: number | null;
  selfDrive: boolean;
  driverDailyCents: number | null;
  location: string;
  imageUrl: string | null;
  images: string[];
  isActive: boolean;
};

export async function saveCar(courierId: string, input: CarInput, carId?: string) {
  const courier = await db.query.couriers.findFirst({ where: eq(couriers.id, courierId), columns: { services: true } });
  if (!courier?.services.includes("car_hire")) throw new TransportError("Tick Car hire under your services on your profile first.");
  if (input.title.length < 3) throw new TransportError("Name the car, e.g. 2016 Toyota Axio.");
  if (!input.dailyCents || input.dailyCents <= 0) throw new TransportError("Enter the price per day.");
  if (!input.selfDrive && !input.driverDailyCents) throw new TransportError("Offer the car self-drive, with a driver, or both.");
  if (input.location.length < 3) throw new TransportError("Say where the car is collected.");
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 60) throw new TransportError("Enter the number of seats.");
  const values = {
    title: input.title.slice(0, 120),
    description: input.description.slice(0, 3000),
    seats: input.seats,
    transmission: input.transmission,
    dailyCents: input.dailyCents,
    selfDrive: input.selfDrive,
    driverDailyCents: input.driverDailyCents,
    location: input.location.slice(0, 200),
    images: input.images.slice(0, 8),
    isActive: input.isActive,
    ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
  };
  if (carId) {
    const [row] = await db.update(hireCars).set(values).where(and(eq(hireCars.id, carId), eq(hireCars.courierId, courierId))).returning({ id: hireCars.id });
    if (!row) throw new TransportError("Car not found.");
    return row.id;
  }
  const [row] = await db.insert(hireCars).values({ ...values, courierId }).returning({ id: hireCars.id });
  return row.id;
}

export function courierCars(courierId: string) {
  return db.query.hireCars.findMany({ where: eq(hireCars.courierId, courierId), orderBy: desc(hireCars.createdAt) });
}

/** Cars customers can book: active, from approved couriers. */
export async function listCars(opts: { q?: string; seats?: number; driver?: boolean } = {}) {
  const rows = await db.query.hireCars.findMany({
    where: eq(hireCars.isActive, true),
    orderBy: asc(hireCars.dailyCents),
    with: { courier: { columns: { name: true, status: true } } },
    limit: 120,
  });
  const q = opts.q?.toLowerCase();
  const cars = rows.filter(
    (c) =>
      c.courier.status === "approved" &&
      (!q || `${c.title} ${c.location}`.toLowerCase().includes(q)) &&
      (!opts.seats || c.seats >= opts.seats) &&
      (!opts.driver || c.driverDailyCents != null),
  );
  const ratings = await courierRatings([...new Set(cars.map((c) => c.courierId))]);
  return cars.map((c) => ({ ...c, ownerRating: ratings.get(c.courierId) ?? null }));
}

/** A hire car's page: its details and the days already taken. */
export async function carDetail(carId: string) {
  const car = await db.query.hireCars.findFirst({
    where: eq(hireCars.id, carId),
    with: { courier: { columns: { id: true, name: true, status: true, bio: true } } },
  });
  if (!car || !car.isActive || car.courier.status !== "approved") return null;
  const ownerRating = (await courierRatings([car.courierId])).get(car.courierId) ?? null;
  const taken = await db
    .select({ startDate: carBookings.startDate, endDate: carBookings.endDate })
    .from(carBookings)
    .where(and(eq(carBookings.carId, carId), eq(carBookings.status, "confirmed"), gte(carBookings.endDate, today())))
    .orderBy(asc(carBookings.startDate));
  return { car, taken, ownerRating };
}

/** Confirmed bookings of a car that overlap the given days. */
function overlapping(carId: string, start: string, end: string) {
  return db.query.carBookings.findFirst({
    where: and(eq(carBookings.carId, carId), eq(carBookings.status, "confirmed"), lte(carBookings.startDate, end), gte(carBookings.endDate, start)),
  });
}

export function carPrice(car: { dailyCents: number; driverDailyCents: number | null }, days: number, withDriver: boolean) {
  return days * (car.dailyCents + (withDriver ? (car.driverDailyCents ?? 0) : 0));
}

/** A customer asks to book a car for a range of days; the owner confirms or declines. */
export async function bookCar(customerId: string, carId: string, input: { startDate: string; endDate: string; withDriver: boolean; note: string; contactPhone: string }) {
  const detail = await carDetail(carId);
  if (!detail) throw new TransportError("This car isn't available.");
  const { car } = detail;
  if (!isDateStr(input.startDate) || !isDateStr(input.endDate)) throw new TransportError("Choose the first and last day.");
  if (input.startDate < today()) throw new TransportError("The first day can't be in the past.");
  if (input.endDate < input.startDate) throw new TransportError("The last day can't be before the first day.");
  const days = daysBetween(input.startDate, input.endDate);
  if (days > 90) throw new TransportError("Bookings are for up to 90 days. Message the owner for longer.");
  if (input.withDriver && car.driverDailyCents == null) throw new TransportError("This car isn't offered with a driver.");
  if (!input.withDriver && !car.selfDrive) throw new TransportError("This car is only hired with a driver.");
  if (!PHONE.test(input.contactPhone)) throw new TransportError("Enter a phone number the owner can call.");
  if (await overlapping(carId, input.startDate, input.endDate)) throw new TransportError("The car is already booked on some of those days.");

  const [booking] = await db
    .insert(carBookings)
    .values({
      number: referenceNumber("CH"),
      carId,
      customerId,
      startDate: input.startDate,
      endDate: input.endDate,
      withDriver: input.withDriver,
      totalCents: carPrice(car, days, input.withDriver),
      note: input.note.slice(0, 500) || null,
      contactPhone: input.contactPhone.slice(0, 30),
    })
    .returning();
  const owner = await db.query.couriers.findFirst({ where: eq(couriers.id, car.courierId), columns: { userId: true } });
  await notify([owner?.userId], { title: `Booking request for your ${car.title}`, body: `${input.startDate} to ${input.endDate}`, href: "/courier/cars" }, { email: true });
  return booking;
}

/** The car's owner confirms (if the days are still free), declines or completes a booking. */
export async function respondToBooking(courierId: string, bookingId: string, action: "confirm" | "decline" | "complete", note: string) {
  const b = await db.query.carBookings.findFirst({ where: eq(carBookings.id, bookingId), with: { car: true } });
  if (!b || b.car.courierId !== courierId) throw new TransportError("Booking not found.");
  if (action === "complete") {
    if (b.status !== "confirmed") throw new TransportError("Only confirmed bookings can be completed.");
    await db.update(carBookings).set({ status: "completed" }).where(eq(carBookings.id, b.id));
    return;
  }
  if (b.status !== "requested") throw new TransportError("This booking was already answered.");
  if (action === "confirm" && (await overlapping(b.carId, b.startDate, b.endDate))) {
    throw new TransportError("You've already confirmed another booking on some of these days.");
  }
  await db
    .update(carBookings)
    .set({ status: action === "confirm" ? "confirmed" : "declined", ownerNote: note.slice(0, 300) || null })
    .where(eq(carBookings.id, b.id));
  await notify(
    [b.customerId],
    action === "confirm"
      ? { title: `Car hire confirmed: ${b.car.title}`, body: `${b.startDate} to ${b.endDate}. Collect it at ${b.car.location}.`, href: "/account/transport" }
      : { title: `Car hire not available: ${b.car.title}`, body: note || undefined, href: "/account/transport" },
    { email: true },
  );
}

export async function cancelBooking(customerId: string, bookingId: string) {
  const b = await db.query.carBookings.findFirst({ where: and(eq(carBookings.id, bookingId), eq(carBookings.customerId, customerId)), with: { car: true } });
  if (!b || (b.status !== "requested" && b.status !== "confirmed")) throw new TransportError("This booking can't be cancelled.");
  await db.update(carBookings).set({ status: "cancelled" }).where(eq(carBookings.id, b.id));
  const owner = await db.query.couriers.findFirst({ where: eq(couriers.id, b.car.courierId), columns: { userId: true } });
  await notify([owner?.userId], { title: `Booking ${b.number} was cancelled`, body: `${b.car.title}, ${b.startDate} to ${b.endDate}`, href: "/courier/cars" });
}

/** A car owner's booking requests and bookings, with the customer's phone. */
export function bookingsForOwner(courierId: string) {
  return db
    .select({
      id: carBookings.id,
      number: carBookings.number,
      startDate: carBookings.startDate,
      endDate: carBookings.endDate,
      withDriver: carBookings.withDriver,
      totalCents: carBookings.totalCents,
      note: carBookings.note,
      status: carBookings.status,
      contactPhone: carBookings.contactPhone,
      carTitle: hireCars.title,
      customerName: schema.users.name,
      createdAt: carBookings.createdAt,
    })
    .from(carBookings)
    .innerJoin(hireCars, eq(hireCars.id, carBookings.carId))
    .innerJoin(schema.users, eq(schema.users.id, carBookings.customerId))
    .where(and(eq(hireCars.courierId, courierId), or(gte(carBookings.endDate, today()), eq(carBookings.status, "requested"))))
    .orderBy(asc(carBookings.startDate));
}

/** A customer's car bookings, with the owner's phone once confirmed. */
export async function customerBookings(customerId: string) {
  const rows = await db.query.carBookings.findMany({
    where: eq(carBookings.customerId, customerId),
    orderBy: desc(carBookings.createdAt),
    limit: 50,
    with: { car: { columns: { id: true, title: true, location: true }, with: { courier: { columns: { name: true, phone: true } } } } },
  });
  return rows.map(({ car: { courier, ...car }, ...b }) => ({
    ...b,
    car: { ...car, owner: courier.name },
    ownerPhone: b.status === "confirmed" ? courier.phone : null,
  }));
}

// ---------------------------------------------------------------- admin

/** Open requests nobody has offered on after UNANSWERED_HOURS. */
export const unansweredJobs = () =>
  and(
    eq(transportJobs.status, "open"),
    sql`${transportJobs.createdAt} < now() - make_interval(hours => ${UNANSWERED_HOURS})`,
    sql`not exists (select 1 from ${transportOffers} where ${qualified(transportOffers.jobId)} = ${qualified(transportJobs.id)} and ${qualified(transportOffers.status)} = 'offered')`,
  );

/** What happened in Transport over the last `days` days. */
export async function transportStats(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [jobs, bookings, [waiting]] = await Promise.all([
    db
      .select({ type: transportJobs.type, status: transportJobs.status, n: sql<number>`count(*)::int` })
      .from(transportJobs)
      .where(gte(transportJobs.createdAt, since))
      .groupBy(transportJobs.type, transportJobs.status),
    db
      .select({ status: carBookings.status, n: sql<number>`count(*)::int` })
      .from(carBookings)
      .where(gte(carBookings.createdAt, since))
      .groupBy(carBookings.status),
    db.select({ n: sql<number>`count(*)::int` }).from(transportJobs).where(unansweredJobs()),
  ]);
  const byType = (t: TransportType) => jobs.filter((j) => j.type === t).reduce((s, j) => s + j.n, 0);
  const byStatus = (st: TransportJobStatus) => jobs.filter((j) => j.status === st).reduce((s, j) => s + j.n, 0);
  return {
    days,
    total: jobs.reduce((s, j) => s + j.n, 0),
    types: { taxi: byType("taxi"), moving: byType("moving"), parcel: byType("parcel"), car_hire: byType("car_hire") },
    booked: byStatus("booked"),
    completed: byStatus("completed"),
    cancelled: byStatus("cancelled"),
    carBookings: bookings.reduce((s, b) => s + b.n, 0),
    carConfirmed: bookings.filter((b) => b.status === "confirmed" || b.status === "completed").reduce((s, b) => s + b.n, 0),
    unanswered: waiting.n,
  };
}

/** Every request, for admins: all contact details and offers, so disputes can be sorted out. */
export async function adminJobs(filter: { type?: TransportType; status?: TransportJobStatus; q?: string; unanswered?: boolean }) {
  const where: (SQL | undefined)[] = [
    filter.type ? eq(transportJobs.type, filter.type) : undefined,
    filter.status ? eq(transportJobs.status, filter.status) : undefined,
    filter.unanswered ? unansweredJobs() : undefined,
  ];
  if (filter.q) {
    const term = `%${filter.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(
      or(
        ilike(transportJobs.number, term),
        sql`${qualified(transportJobs.customerId)} in (select ${qualified(schema.users.id)} from ${schema.users} where ${qualified(schema.users.name)} ilike ${term} or ${qualified(schema.users.email)} ilike ${term})`,
        sql`${qualified(transportJobs.courierId)} in (select ${qualified(couriers.id)} from ${couriers} where ${qualified(couriers.name)} ilike ${term})`,
      ),
    );
  }
  // Filter with a plain select (the raw SQL above names tables directly), then load the details.
  const ids = (
    await db.select({ id: transportJobs.id }).from(transportJobs).where(and(...where)).orderBy(desc(transportJobs.createdAt)).limit(100)
  ).map((r) => r.id);
  if (!ids.length) return [];
  const jobs = await db.query.transportJobs.findMany({
    where: inArray(transportJobs.id, ids),
    orderBy: desc(transportJobs.createdAt),
    limit: 100,
    with: {
      customer: { columns: { id: true, name: true, email: true } },
      courier: { columns: { id: true, name: true, phone: true } },
      offers: { orderBy: asc(transportOffers.priceCents), with: { courier: { columns: { id: true, name: true, phone: true } } } },
    },
  });
  // The courier's rating for each finished job
  const ratings = jobs.length
    ? await db
        .select({ jobId: schema.reviews.transportJobId, rating: schema.reviews.rating, comment: schema.reviews.comment })
        .from(schema.reviews)
        .where(inArray(schema.reviews.transportJobId, jobs.map((j) => j.id)))
    : [];
  return jobs.map((j) => ({ ...j, review: ratings.find((r) => r.jobId === j.id) ?? null }));
}

/** An admin cancels a fake, abusive or duplicate request; the customer and any booked courier are told why. */
export async function adminCancelJob(jobId: string, reason: string) {
  if (reason.trim().length < 3) throw new TransportError("Give a reason; it's sent to the people involved.");
  const job = await db.query.transportJobs.findFirst({ where: eq(transportJobs.id, jobId), with: { courier: true } });
  if (!job || (job.status !== "open" && job.status !== "booked")) throw new TransportError("Only open or booked requests can be cancelled.");
  await db.update(transportJobs).set({ status: "cancelled" }).where(eq(transportJobs.id, job.id));
  await db.update(transportOffers).set({ status: "declined" }).where(and(eq(transportOffers.jobId, job.id), eq(transportOffers.status, "offered")));
  const notice = { title: `${job.number} was cancelled by MyPlug`, body: reason.trim().slice(0, 300) };
  await notify([job.customerId], { ...notice, href: `/transport/jobs/${job.id}` }, { email: true });
  if (job.courier) await notify([job.courier.userId], { ...notice, href: `/courier/transport/${job.id}` }, { email: true });
}

/** Every hire car, with its owner and number of bookings. */
export function adminCars() {
  return db
    .select({
      id: hireCars.id,
      title: hireCars.title,
      seats: hireCars.seats,
      dailyCents: hireCars.dailyCents,
      driverDailyCents: hireCars.driverDailyCents,
      location: hireCars.location,
      imageUrl: hireCars.imageUrl,
      isActive: hireCars.isActive,
      courierId: couriers.id,
      courierName: couriers.name,
      bookings: sql<number>`(select count(*) from ${carBookings} where ${qualified(carBookings.carId)} = ${qualified(hireCars.id)})::int`,
    })
    .from(hireCars)
    .innerJoin(couriers, eq(couriers.id, hireCars.courierId))
    .orderBy(desc(hireCars.createdAt))
    .limit(200);
}

/** An admin hides (or shows again) a hire car; the owner is told why. */
export async function adminSetCarActive(carId: string, active: boolean, reason: string) {
  if (!active && reason.trim().length < 3) throw new TransportError("Give a reason; it's sent to the owner.");
  const car = await db.query.hireCars.findFirst({ where: eq(hireCars.id, carId), with: { courier: { columns: { userId: true } } } });
  if (!car) throw new TransportError("Car not found.");
  await db.update(hireCars).set({ isActive: active }).where(eq(hireCars.id, car.id));
  await notify(
    [car.courier.userId],
    active
      ? { title: `Your ${car.title} is visible to customers again`, body: reason.trim() || undefined, href: "/courier/cars" }
      : { title: `MyPlug hid your ${car.title}`, body: reason.trim().slice(0, 300), href: "/courier/cars" },
    { email: true },
  );
}

/** Recent and upcoming car hire bookings, with both phone numbers. */
export function adminBookings() {
  return db
    .select({
      id: carBookings.id,
      number: carBookings.number,
      startDate: carBookings.startDate,
      endDate: carBookings.endDate,
      withDriver: carBookings.withDriver,
      totalCents: carBookings.totalCents,
      status: carBookings.status,
      contactPhone: carBookings.contactPhone,
      note: carBookings.note,
      carTitle: hireCars.title,
      courierId: couriers.id,
      courierName: couriers.name,
      courierPhone: couriers.phone,
      customerId: schema.users.id,
      customerName: schema.users.name,
      createdAt: carBookings.createdAt,
    })
    .from(carBookings)
    .innerJoin(hireCars, eq(hireCars.id, carBookings.carId))
    .innerJoin(couriers, eq(couriers.id, hireCars.courierId))
    .innerJoin(schema.users, eq(schema.users.id, carBookings.customerId))
    .where(gte(carBookings.endDate, new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)))
    .orderBy(desc(carBookings.startDate))
    .limit(200);
}

/** An admin cancels a booking; the customer and the owner are told why. */
export async function adminCancelBooking(bookingId: string, reason: string) {
  if (reason.trim().length < 3) throw new TransportError("Give a reason; it's sent to the people involved.");
  const b = await db.query.carBookings.findFirst({ where: eq(carBookings.id, bookingId), with: { car: { with: { courier: { columns: { userId: true } } } } } });
  if (!b || (b.status !== "requested" && b.status !== "confirmed")) throw new TransportError("Only waiting or confirmed bookings can be cancelled.");
  await db.update(carBookings).set({ status: "cancelled", ownerNote: `Cancelled by MyPlug: ${reason.trim().slice(0, 250)}` }).where(eq(carBookings.id, b.id));
  const notice = { title: `Car hire ${b.number} was cancelled by MyPlug`, body: reason.trim().slice(0, 300) };
  await notify([b.customerId], { ...notice, href: "/account/transport" }, { email: true });
  await notify([b.car.courier.userId], { ...notice, href: "/courier/cars" }, { email: true });
}
