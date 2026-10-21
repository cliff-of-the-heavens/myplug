import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { MediaType } from "~/db/schema";
import { MEDIA_TYPES } from "./digital";
import { parseMoney } from "./format";
import { notify } from "./notify.server";
import { storeFile, storePrivateFile, StorageError } from "./storage.server";

const { digitalOffers, digitalGrants, products, orders, orderEvents } = schema;

export class DigitalError extends Error {}

/** Reads the offer rows (label/mode/price/accessDays/maxViews) of the digital product form. */
export function offersFromForm(form: FormData) {
  const col = (k: string) => form.getAll(k).map(String);
  const labels = col("offerLabel");
  const modes = col("offerMode");
  const prices = col("offerPrice");
  const days = col("offerDays");
  const views = col("offerViews");
  const offers = labels
    .map((label, i) => {
      const priceCents = parseMoney(prices[i] ?? null);
      const mode = modes[i] === "download" ? ("download" as const) : ("stream" as const);
      const accessDays = Number(days[i]) > 0 ? Math.min(3650, Math.floor(Number(days[i]))) : null;
      const maxViews = mode === "stream" && Number(views[i]) > 0 ? Math.min(1000, Math.floor(Number(views[i]))) : null;
      return { label: label.trim().slice(0, 60), mode, priceCents: priceCents ?? 0, accessDays, maxViews, position: i };
    })
    .filter((o) => o.label && o.priceCents > 0);
  if (!offers.length) throw new DigitalError("Add at least one price option (name and price).");
  return offers;
}

/** Saves a digital product's files and price options. The full file is private; the preview is public. */
export async function saveDigital(
  productId: string,
  input: { mediaType: MediaType; offers: ReturnType<typeof offersFromForm>; mediaFile: FormDataEntryValue | null; mediaKey: string | null; previewFile: FormDataEntryValue | null; previewUrl: string | null },
) {
  const allowed = MEDIA_TYPES[input.mediaType];
  const update: Partial<typeof products.$inferInsert> = { mediaType: input.mediaType };

  // Full file: either already uploaded straight to private Blob storage, or sent with the form.
  if (input.mediaKey) {
    if (!/^blob:private\/media\/[\w-]+\.[a-z0-9]+$/i.test(input.mediaKey)) throw new DigitalError("Invalid media upload.");
    update.mediaKey = input.mediaKey;
    update.mediaName = input.mediaKey.split("/").pop() ?? null;
  } else if (input.mediaFile && typeof input.mediaFile !== "string" && input.mediaFile.size > 0) {
    if (!allowed.includes(input.mediaFile.type)) throw new DigitalError(`That file type isn't allowed for ${input.mediaType}.`);
    try {
      const ext = input.mediaFile.name.split(".").pop()?.toLowerCase() ?? "bin";
      update.mediaKey = await storePrivateFile(`media/${crypto.randomUUID()}.${ext}`, input.mediaFile);
      update.mediaName = input.mediaFile.name.slice(0, 120);
    } catch (e) {
      if (e instanceof StorageError) throw new DigitalError(e.message);
      throw e;
    }
  }

  // Preview: public sample (trailer, clip, first pages).
  if (input.previewUrl) {
    if (!/^https:\/\/[\w.-]+\.public\.blob\.vercel-storage\.com\/previews\//.test(input.previewUrl)) throw new DigitalError("Invalid preview upload.");
    update.previewUrl = input.previewUrl;
  } else if (input.previewFile && typeof input.previewFile !== "string" && input.previewFile.size > 0) {
    if (!allowed.includes(input.previewFile.type)) throw new DigitalError("The preview must be the same kind of file.");
    try {
      const ext = input.previewFile.name.split(".").pop()?.toLowerCase() ?? "bin";
      update.previewUrl = await storeFile(`previews/${crypto.randomUUID()}.${ext}`, input.previewFile as File);
    } catch (e) {
      if (e instanceof StorageError) throw new DigitalError(e.message);
      throw e;
    }
  }

  await db.transaction(async (tx) => {
    const [p] = await tx.select({ mediaKey: products.mediaKey }).from(products).where(eq(products.id, productId));
    if (!update.mediaKey && !p?.mediaKey) throw new DigitalError("Upload the full file customers will get.");
    await tx
      .update(products)
      .set({ ...update, priceCents: Math.min(...input.offers.map((o) => o.priceCents)), trackStock: false })
      .where(eq(products.id, productId));
    await tx.delete(digitalOffers).where(eq(digitalOffers.productId, productId));
    await tx.insert(digitalOffers).values(input.offers.map((o) => ({ ...o, productId })));
  });
}

export function offersFor(productId: string) {
  return db.query.digitalOffers.findMany({ where: eq(digitalOffers.productId, productId), orderBy: asc(digitalOffers.position) });
}

/** Payment confirmed: the buyer's access starts now (and runs for the offer's number of days). */
export async function activateGrantForOrder(orderId: string, actorId: string) {
  const grant = await db.query.digitalGrants.findFirst({ where: eq(digitalGrants.orderId, orderId) });
  if (!grant || grant.activatedAt) return;
  const now = new Date();
  await db
    .update(digitalGrants)
    .set({ activatedAt: now, expiresAt: grant.accessDays ? new Date(now.getTime() + grant.accessDays * 86_400_000) : null })
    .where(eq(digitalGrants.id, grant.id));
  // Nothing to ship: the order is complete once access is granted.
  await db.update(orders).set({ status: "delivered", updatedAt: now }).where(eq(orders.id, orderId));
  await db.insert(orderEvents).values({ orderId, status: "delivered", note: "Payment received: access granted", actorId });
  await notify([grant.userId], { title: "Your purchase is ready", body: grant.label, href: "/account/library" }, { email: true });
}

export type GrantState = "awaiting_payment" | "active" | "expired" | "used_up";

export function grantState(g: { activatedAt: Date | null; expiresAt: Date | null; maxViews: number | null; viewsUsed: number; mode: string }): GrantState {
  if (!g.activatedAt) return "awaiting_payment";
  if (g.expiresAt && g.expiresAt.getTime() < Date.now()) return "expired";
  if (g.mode === "stream" && g.maxViews && g.viewsUsed >= g.maxViews) return "used_up";
  return "active";
}

const TOKEN_HOURS = 6;

function signToken(grantId: string, purpose: "stream" | "download", exp: number) {
  return createHmac("sha256", process.env.SESSION_SECRET!).update(`media:${grantId}:${purpose}:${exp}`).digest("base64url");
}

/**
 * Starts a viewing (or download): counts it against the grant's limits and returns a short-lived
 * signed link. The player's range requests reuse that link, so one opening counts once.
 */
export async function startAccess(userId: string, grantId: string, purpose: "stream" | "download") {
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(digitalGrants).where(and(eq(digitalGrants.id, grantId), eq(digitalGrants.userId, userId))).for("update");
    if (!g) throw new DigitalError("Not found.");
    const state = grantState(g);
    if (state !== "active") {
      throw new DigitalError(state === "awaiting_payment" ? "Access starts once the seller confirms your payment." : state === "expired" ? "Your access has expired." : "You've used all your views.");
    }
    if (purpose === "download" && g.mode !== "download") throw new DigitalError("This purchase is for watching online only.");
    await tx
      .update(digitalGrants)
      .set(purpose === "stream" ? { viewsUsed: sql`${digitalGrants.viewsUsed} + 1` } : { downloads: sql`${digitalGrants.downloads} + 1` })
      .where(eq(digitalGrants.id, g.id));
    const exp = Date.now() + TOKEN_HOURS * 3_600_000;
    return `/media/${g.id}?p=${purpose}&e=${exp}&t=${signToken(g.id, purpose, exp)}`;
  });
}

/** Checks a media link and returns the file to serve, or null. */
export async function checkMediaLink(userId: string, grantId: string, purpose: string | null, exp: string | null, token: string | null) {
  if ((purpose !== "stream" && purpose !== "download") || !exp || !token || Number(exp) < Date.now()) return null;
  const expected = Buffer.from(signToken(grantId, purpose, Number(exp)));
  const given = Buffer.from(token);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const g = await db.query.digitalGrants.findFirst({
    where: and(eq(digitalGrants.id, grantId), eq(digitalGrants.userId, userId)),
    with: { product: { columns: { mediaKey: true, mediaName: true, title: true } } },
  });
  // Already counted when the link was made; only check it hasn't expired since.
  if (!g?.product.mediaKey || !g.activatedAt || (g.expiresAt && g.expiresAt.getTime() < Date.now())) return null;
  return { key: g.product.mediaKey, name: g.product.mediaName ?? g.product.title, purpose };
}
