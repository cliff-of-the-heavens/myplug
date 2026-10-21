import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { notify } from "./notify.server";
import { parseMoney } from "./format";
import { str } from "./utils";

const { couriers, courierRates, courierQuotes, deliveries, orders, stores } = schema;

export class CourierError extends Error {}

export function getCourier(courierId: string) {
  return db.query.couriers.findFirst({
    where: eq(couriers.id, courierId),
    with: { rates: { orderBy: courierRates.area } },
  });
}

/** Saves the courier's profile. Changing identity details sends the account back for review. */
export async function saveProfile(
  courierId: string,
  input: { name: string; phone: string; vehicle: string; plateNumber: string; nationalIdNumber: string; bio: string; facePhotoKey: string | null; idDocumentKey: string | null },
) {
  const current = await getCourier(courierId);
  if (!current) throw new CourierError("Courier not found.");
  if (input.name.length < 2) throw new CourierError("Enter your name or company name.");
  if (!/^\+?[\d\s-]{7,}$/.test(input.phone)) throw new CourierError("Enter a valid phone number.");
  if (input.nationalIdNumber.length < 4) throw new CourierError("Enter your national ID number.");
  const face = input.facePhotoKey ?? current.facePhotoKey;
  const idDoc = input.idDocumentKey ?? current.idDocumentKey;
  if (!face) throw new CourierError("Add a clear photo of your face.");
  if (!idDoc) throw new CourierError("Add a photo of your ID document.");

  const identityChanged =
    !!input.facePhotoKey || !!input.idDocumentKey || input.nationalIdNumber !== current.nationalIdNumber || input.name !== current.name;
  // A rejected courier, or an approved one who changes identity details, is reviewed again.
  const status = current.status === "rejected" || (current.status === "approved" && identityChanged) ? "pending" : current.status;
  await db
    .update(couriers)
    .set({
      name: input.name.slice(0, 80),
      phone: input.phone.slice(0, 30),
      vehicle: input.vehicle.slice(0, 60) || null,
      plateNumber: input.plateNumber.slice(0, 20) || null,
      nationalIdNumber: input.nationalIdNumber.slice(0, 40),
      bio: input.bio.slice(0, 500) || null,
      facePhotoKey: face,
      idDocumentKey: idDoc,
      status,
      updatedAt: new Date(),
    })
    .where(eq(couriers.id, courierId));
  return status;
}

/** Replaces the courier's area price list from form rows `area` / `price`. */
export async function saveRates(courierId: string, form: FormData) {
  const areas = form.getAll("area").map(String);
  const prices = form.getAll("price");
  const rows: { area: string; estimateCents: number }[] = [];
  areas.forEach((a, i) => {
    const area = a.trim().slice(0, 60);
    const cents = parseMoney(prices[i] ?? null);
    if (area && cents && !rows.some((r) => r.area.toLowerCase() === area.toLowerCase())) rows.push({ area, estimateCents: cents });
  });
  await db.transaction(async (tx) => {
    await tx.delete(courierRates).where(eq(courierRates.courierId, courierId));
    if (rows.length) await tx.insert(courierRates).values(rows.map((r) => ({ ...r, courierId })));
  });
  return rows.length;
}

/** What a courier sees: open invitations, active jobs and recent completed ones. */
export async function courierJobs(courierId: string) {
  const invites = await db
    .select({
      quoteId: courierQuotes.id,
      status: courierQuotes.status,
      direct: courierQuotes.direct,
      estimateCents: courierQuotes.estimateCents,
      quoteCents: courierQuotes.quoteCents,
      deliveryId: deliveries.id,
      area: deliveries.area,
      city: deliveries.city,
      pickupAt: deliveries.pickupAt,
      feePaidBy: deliveries.feePaidBy,
      orderNumber: orders.number,
      currency: orders.currency,
      storeName: stores.name,
      storeArea: stores.pickupAddress,
      createdAt: courierQuotes.createdAt,
    })
    .from(courierQuotes)
    .innerJoin(deliveries, eq(deliveries.id, courierQuotes.deliveryId))
    .innerJoin(orders, eq(orders.id, deliveries.orderId))
    .innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(eq(courierQuotes.courierId, courierId), inArray(courierQuotes.status, ["invited", "quoted"]), inArray(orders.status, ["pending", "confirmed", "processing"])))
    .orderBy(desc(courierQuotes.createdAt));

  const jobs = await db.query.deliveries.findMany({
    where: eq(deliveries.courierId, courierId),
    columns: { phraseHash: false, collectorPhotoKey: false },
    orderBy: desc(deliveries.updatedAt),
    limit: 40,
    with: {
      order: {
        columns: { id: true, number: true, status: true, shippingAddress: true, notes: true, currency: true },
        with: {
          items: { columns: { title: true, quantity: true } },
          store: { columns: { name: true, pickupAddress: true }, with: { owner: { columns: { phone: true } } } },
        },
      },
    },
  });
  return { invites, jobs };
}

/** Admin decision on a courier's registration. */
export async function reviewCourier(courierId: string, action: "approve" | "reject" | "suspend" | "reactivate", note: string) {
  const c = await getCourier(courierId);
  if (!c) throw new CourierError("Courier not found.");
  if ((action === "reject" || action === "suspend") && !note) throw new CourierError("Give the courier a reason.");
  if (action === "approve" && (!c.facePhotoKey || !c.idDocumentKey)) throw new CourierError("This courier hasn't uploaded their photo and ID yet.");
  const status = { approve: "approved", reject: "rejected", suspend: "suspended", reactivate: "approved" }[action] as "approved" | "rejected" | "suspended";
  await db.update(couriers).set({ status, reviewNote: note || null, reviewedAt: new Date() }).where(eq(couriers.id, courierId));
  await notify([c.userId], {
    title: status === "approved" ? "Your courier account is approved" : `Your courier account was ${status}`,
    body: note || (status === "approved" ? "You can now receive delivery requests." : undefined),
    href: "/courier",
  }, { email: true });
}

/** Deliveries where this user may see a courier's photo: the merchant or customer of an order they're on. */
export async function canSeeCourier(viewer: { id: string; role: string; storeId: string | null; courierId: string | null }, courierId: string) {
  if (viewer.role === "admin" || viewer.courierId === courierId) return true;
  // Any courier invited to, quoting for or assigned to one of the viewer's orders (assignments also have a quote row).
  const rows = await db
    .select({ id: deliveries.id })
    .from(courierQuotes)
    .innerJoin(deliveries, eq(deliveries.id, courierQuotes.deliveryId))
    .innerJoin(orders, eq(orders.id, deliveries.orderId))
    .where(and(eq(courierQuotes.courierId, courierId), viewer.storeId ? eq(orders.storeId, viewer.storeId) : eq(orders.customerId, viewer.id)))
    .limit(1);
  return rows.length > 0;
}

export function courierFromForm(form: FormData) {
  return {
    name: str(form.get("name")),
    phone: str(form.get("phone")),
    vehicle: str(form.get("vehicle")),
    plateNumber: str(form.get("plateNumber")),
    nationalIdNumber: str(form.get("nationalIdNumber")),
    bio: str(form.get("bio")),
  };
}

