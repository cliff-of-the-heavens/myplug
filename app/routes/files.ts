import { eq } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { getUser } from "~/lib/auth.server";
import { canSeeCourier } from "~/lib/couriers.server";
import { privateFileResponse } from "~/lib/storage.server";
import { isUuid } from "~/lib/utils";
import type { Route } from "./+types/files";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * Serves private files after checking who's asking:
 * - /files/courier/:id?which=face  courier's face photo: admins, and the store/customer of an order they're on
 * - /files/courier/:id?which=id    courier's ID document: admins only
 * - /files/collector/:deliveryId   photo of someone collecting for a customer: admins, that store, that customer
 * - /files/license/:id             business licence: admins and the owner; everyone if verified and shared
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  if (!isUuid(params.id)) return notFound();
  const user = await getUser(request);
  const which = new URL(request.url).searchParams.get("which");

  if (params.type === "courier") {
    const c = await db.query.couriers.findFirst({ where: eq(schema.couriers.id, params.id) });
    if (!c || !user) return notFound();
    const key = which === "id" ? c.idDocumentKey : c.facePhotoKey;
    const allowed = which === "id" ? user.role === "admin" || user.courierId === c.id : await canSeeCourier(user, c.id);
    return allowed && key ? privateFileResponse(key, request) : notFound();
  }

  if (params.type === "collector") {
    const d = await db.query.deliveries.findFirst({
      where: eq(schema.deliveries.id, params.id),
      with: { order: { columns: { customerId: true, storeId: true } } },
    });
    if (!d?.collectorPhotoKey || !user) return notFound();
    const allowed = user.role === "admin" || user.id === d.order.customerId || user.storeId === d.order.storeId;
    return allowed ? privateFileResponse(d.collectorPhotoKey, request) : notFound();
  }

  if (params.type === "license") {
    const l = await db.query.businessLicenses.findFirst({ where: eq(schema.businessLicenses.id, params.id) });
    if (!l?.documentKey) return notFound();
    const isPublic = l.status === "verified" && l.showToCustomers;
    const allowed = isPublic || user?.role === "admin" || (!!user?.storeId && user.storeId === l.storeId);
    return allowed ? privateFileResponse(l.documentKey, request, { "Content-Disposition": "inline" }) : notFound();
  }

  return notFound();
}
