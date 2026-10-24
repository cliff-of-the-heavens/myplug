import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, asc, avg, count, desc, eq, gt, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { AdPlacement } from "~/db/schema";
import { recordAdClick } from "./analytics.server";
import { getUser } from "./auth.server";
import { cached, invalidate } from "./cache.server";
import { APP_TIME_ZONE, isDateStr, today } from "./dates";
import { appUrl, EMAIL_PROVIDER_CONFIGURED, escapeHtml, sendEmails } from "./email.server";
import { DEFAULT_CURRENCY, money, parseMoney } from "./format";
import { imageSize } from "./image-size.server";
import { notify, notifyAdmins } from "./notify.server";
import { referenceNumber } from "./orders.server";
import { getSettings, intSetting, setSettings } from "./settings.server";
import { StorageError, storeFile } from "./storage.server";
import { AD_FREE_PLANS, ASPECT_TOLERANCE, cleanLink, formatList, MAX_WEEKS, MIN_WIDTH_RATIO } from "./banners";
import { str } from "./utils";

const { adPlacements, adCampaigns, adUploadLinks, adFreePasses, users, orders, stores, reviews } = schema;

export class BannerError extends Error {}

const DAY = 86_400_000;
const UPLOAD_LINK_DAYS = 14;
const MAX_PASSCODE_TRIES = 5;

// ---------------------------------------------------------------- settings

export type HeroPanel = "top_selling" | "top_rated" | "off";

export async function bannerSettings() {
  const s = await getSettings();
  const panel = s.hero_panel;
  return {
    heroPanel: (panel === "top_rated" || panel === "off" ? panel : "top_selling") as HeroPanel,
    adsEmail: s.ads_email || "ads@myplug.mw",
    adFreeCents: intSetting(s, "adfree_price_cents", 500000, 0), // per 30 days
  };
}

export async function saveBannerSettings(form: FormData) {
  const panel = str(form.get("heroPanel"));
  const email = str(form.get("adsEmail")).toLowerCase();
  const price = parseMoney(form.get("adFreePrice"));
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new BannerError("Enter a valid email address for ad enquiries.");
  if (price == null || price < 0) throw new BannerError("Enter the ad-free price.");
  await setSettings({ hero_panel: ["top_selling", "top_rated", "off"].includes(panel) ? panel : "top_selling", ads_email: email, adfree_price_cents: String(price) });
  invalidate("top-shops");
}

export function getPlacements({ activeOnly = false } = {}) {
  return db.query.adPlacements.findMany({ where: activeOnly ? eq(adPlacements.isActive, true) : undefined, orderBy: asc(adPlacements.position) });
}

async function getPlacement(key: string) {
  const p = await db.query.adPlacements.findFirst({ where: eq(adPlacements.key, key) });
  if (!p) throw new BannerError("Choose where the ad should appear.");
  return p;
}

export async function updatePlacement(key: string, form: FormData) {
  const p = await getPlacement(key);
  const num = (name: string, min: number, max: number) => {
    const n = Number(form.get(name));
    if (!Number.isInteger(n) || n < min || n > max) throw new BannerError(`${p.name}: ${name} must be between ${min} and ${max}.`);
    return n;
  };
  const weekly = parseMoney(form.get("weekly"));
  if (weekly == null || weekly <= 0) throw new BannerError(`${p.name}: enter the weekly price.`);
  await db
    .update(adPlacements)
    .set({
      width: num("width", 100, 4000),
      height: num("height", 50, 4000),
      maxKb: num("maxKb", 50, 4000),
      maxActive: num("maxActive", 1, 20),
      weeklyCents: weekly,
      isActive: form.get("isActive") === "on",
      hideableWithPass: form.get("hideable") === "on",
    })
    .where(eq(adPlacements.key, key));
}

/** Weekly price × weeks, in the platform currency. */
export function campaignPrice(p: Pick<AdPlacement, "weeklyCents">, weeks: number) {
  return p.weeklyCents * weeks;
}

// ---------------------------------------------------------------- creative

/**
 * Checks an uploaded banner against the spot's specs (format, file size, shape and minimum
 * width), then stores it. Returns null if no file was chosen.
 */
export async function storeCreative(file: FormDataEntryValue | null, placement: AdPlacement) {
  if (!file || typeof file === "string" || file.size === 0) return null;
  const allowed = placement.formats.split(",").map((f) => f.trim().toLowerCase());
  if (file.size > placement.maxKb * 1024) throw new BannerError(`The image is ${Math.ceil(file.size / 1024)} KB. ${placement.name} banners must be ${placement.maxKb} KB or smaller.`);
  const size = imageSize(new Uint8Array(await file.arrayBuffer()));
  if (!size || !allowed.includes(size.type)) throw new BannerError(`Upload a ${formatList(placement.formats)} image.`);
  const want = placement.width / placement.height;
  const got = size.width / size.height;
  if (Math.abs(got - want) / want > ASPECT_TOLERANCE) {
    throw new BannerError(`The image is ${size.width}×${size.height}px. ${placement.name} banners must be ${placement.width}×${placement.height}px (or the same shape).`);
  }
  if (size.width < placement.width * MIN_WIDTH_RATIO) {
    throw new BannerError(`The image is only ${size.width}px wide and would look blurry. Use ${placement.width}×${placement.height}px.`);
  }
  try {
    const url = await storeFile(`banners/${randomUUID()}.${size.type}`, file);
    return { url, width: size.width, height: size.height };
  } catch (e) {
    if (e instanceof StorageError) throw new BannerError(e.message);
    throw e;
  }
}

function adText(form: FormData) {
  const headline = str(form.get("headline")).slice(0, 80) || null;
  const rawLink = str(form.get("linkUrl"));
  const linkUrl = cleanLink(rawLink);
  if (rawLink && !linkUrl) throw new BannerError("The link must be a MyPlug page (starting with /) or a secure https:// website.");
  return { headline, linkUrl };
}

function weeksAndStart(form: FormData) {
  const weeks = Number(form.get("weeks"));
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) throw new BannerError(`Choose between 1 and ${MAX_WEEKS} weeks.`);
  const start = str(form.get("start"));
  if (start && (!isDateStr(start) || start < today())) throw new BannerError("Choose a start date from today onwards.");
  return { weeks, requestedStart: start || null };
}

// ---------------------------------------------------------------- requests

/** A registered member asks for a banner ad, supplying the image up front. */
export async function requestCampaign(user: { id: string; name: string; email: string }, form: FormData) {
  const placement = await getPlacement(str(form.get("placement")));
  if (!placement.isActive) throw new BannerError("That spot isn't available right now.");
  const { weeks, requestedStart } = weeksAndStart(form);
  const { headline, linkUrl } = adText(form);
  const title = str(form.get("title")).slice(0, 80) || headline || "Banner ad";
  const creative = await storeCreative(form.get("creative"), placement);
  if (!creative) throw new BannerError("Attach your banner image.");
  const link = linkUrl ?? (await advertiserStorePath(user.id));
  const [row] = await db
    .insert(adCampaigns)
    .values({
      number: referenceNumber("BA"),
      placementKey: placement.key,
      advertiserId: user.id,
      advertiserName: user.name,
      advertiserEmail: user.email,
      title,
      headline,
      linkUrl: link,
      creativeUrl: creative.url,
      creativeWidth: creative.width,
      creativeHeight: creative.height,
      weeks,
      requestedStart,
      notes: str(form.get("notes")).slice(0, 1000) || null,
      amountCents: campaignPrice(placement, weeks),
    })
    .returning();
  await notifyAdmins({ title: "New banner ad request", body: `${row.number}: ${placement.name}, ${weeks} week${weeks > 1 ? "s" : ""}`, href: `/admin/banners/${row.id}` });
  return row;
}

/** The admin enters an ad for someone without an account (they asked by email or phone). */
export async function createExternalCampaign(form: FormData) {
  const placement = await getPlacement(str(form.get("placement")));
  const { weeks, requestedStart } = weeksAndStart(form);
  const { headline, linkUrl } = adText(form);
  const name = str(form.get("name"));
  const email = str(form.get("email")).toLowerCase();
  if (name.length < 2) throw new BannerError("Enter the advertiser's name.");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new BannerError("Enter the advertiser's email address.");
  const custom = parseMoney(form.get("amount"));
  const creative = await storeCreative(form.get("creative"), placement);
  const [row] = await db
    .insert(adCampaigns)
    .values({
      number: referenceNumber("BA"),
      placementKey: placement.key,
      advertiserName: name,
      advertiserEmail: email,
      advertiserPhone: str(form.get("phone")) || null,
      company: str(form.get("company")) || null,
      title: str(form.get("title")).slice(0, 80) || str(form.get("company")) || name,
      headline,
      linkUrl,
      creativeUrl: creative?.url ?? null,
      creativeWidth: creative?.width ?? null,
      creativeHeight: creative?.height ?? null,
      weeks,
      requestedStart,
      notes: str(form.get("notes")).slice(0, 1000) || null,
      status: "awaiting_payment",
      amountCents: custom && custom > 0 ? custom : campaignPrice(placement, weeks),
    })
    .returning();
  return row;
}

async function getCampaign(id: string) {
  const c = await db.query.adCampaigns.findFirst({ where: eq(adCampaigns.id, id), with: { placement: true } });
  if (!c) throw new BannerError("Ad not found.");
  return c;
}

/** Tells the advertiser: in-app (and by email) for members, by email for outside advertisers. */
async function tellAdvertiser(c: { advertiserId: string | null; advertiserEmail: string; advertiserName: string; number: string }, title: string, body: string) {
  if (c.advertiserId) {
    await notify([c.advertiserId], { title, body, href: "/advertise#my-ads" }, { email: true });
    return;
  }
  await sendEmails([
    {
      to: c.advertiserEmail,
      subject: `MyPlug ad ${c.number}: ${title}`,
      text: `Hi ${c.advertiserName},\n\n${title}\n${body}\n\nReference: ${c.number}\nReply to this email with any questions.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px"><p>Hi ${escapeHtml(c.advertiserName)},</p><p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(body)}</p><p style="color:#777">Reference: ${escapeHtml(c.number)}</p></div>`,
    },
  ]).catch((e) => console.error("Advertiser email failed", e));
}

/** Admin accepts the request (optionally adjusting the price) and asks for payment. */
export async function quoteCampaign(id: string, amountCents: number | null, note: string) {
  const c = await getCampaign(id);
  if (c.status !== "requested" && c.status !== "awaiting_payment") throw new BannerError("This ad has already moved past the quote stage.");
  const amount = amountCents && amountCents > 0 ? amountCents : c.amountCents ?? campaignPrice(c.placement, c.weeks);
  await db.update(adCampaigns).set({ status: "awaiting_payment", amountCents: amount, adminNote: note.trim() || c.adminNote, updatedAt: new Date() }).where(eq(adCampaigns.id, id));
  const pay = (await getSettings()).payment_instructions;
  await tellAdvertiser(c, "Your banner ad is ready for payment", `Please pay ${money(amount, DEFAULT_CURRENCY)} using reference ${c.number}.${pay ? ` ${pay}` : ""}${note.trim() ? ` Note: ${note.trim()}` : ""}`);
}

/** The member reports their payment (reference and/or proof). */
export async function submitCampaignPayment(userId: string, id: string, reference: string, proofUrl: string | null) {
  const c = await getCampaign(id);
  if (c.advertiserId !== userId) throw new BannerError("Ad not found.");
  if (c.status !== "awaiting_payment") throw new BannerError("This ad isn't waiting for payment.");
  if (!reference.trim() && !proofUrl) throw new BannerError("Enter the payment reference or attach proof of payment.");
  await db
    .update(adCampaigns)
    .set({ status: "payment_submitted", paymentReference: reference.trim() || null, proofUrl, paymentSubmittedAt: new Date(), updatedAt: new Date() })
    .where(eq(adCampaigns.id, id));
  await notifyAdmins({ title: "Banner ad payment to check", body: `${c.number}: ${reference.trim() || "proof attached"}`, href: `/admin/banners/${c.id}` });
}

/** Midnight at the start of a calendar day in the app's time zone. */
function startOfDay(day: string) {
  const guess = new Date(`${day}T00:00:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess).map((p) => [p.type, p.value]));
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess.getTime() - (local - guess.getTime()));
}

/**
 * Admin confirms payment and schedules the ad. Refused when the spot already has its maximum
 * number of ads during those dates (the admin picks a later start instead).
 */
export async function approveCampaign(adminId: string, id: string, form: FormData) {
  const c = await getCampaign(id);
  if (!["awaiting_payment", "payment_submitted", "requested"].includes(c.status)) throw new BannerError("This ad can't be approved in its current state.");
  if (!c.creativeUrl) throw new BannerError("This ad has no banner image yet. Upload it or send the advertiser an upload link.");
  const reference = str(form.get("reference")) || c.paymentReference;
  if (!reference) throw new BannerError("Record how it was paid (the payment reference) before approving.");
  const day = str(form.get("start")) || c.requestedStart || today();
  if (!isDateStr(day)) throw new BannerError("Choose a valid start date.");
  const startsAt = day <= today() ? new Date() : startOfDay(day);
  const endsAt = new Date(startsAt.getTime() + c.weeks * 7 * DAY);

  const [{ n }] = await db
    .select({ n: count() })
    .from(adCampaigns)
    .where(and(eq(adCampaigns.placementKey, c.placementKey), eq(adCampaigns.status, "approved"), ne(adCampaigns.id, c.id), lte(adCampaigns.startsAt, endsAt), gte(adCampaigns.endsAt, startsAt)));
  if (n >= c.placement.maxActive) {
    const next = await db
      .select({ endsAt: adCampaigns.endsAt })
      .from(adCampaigns)
      .where(and(eq(adCampaigns.placementKey, c.placementKey), eq(adCampaigns.status, "approved"), gte(adCampaigns.endsAt, startsAt)))
      .orderBy(asc(adCampaigns.endsAt))
      .limit(1);
    throw new BannerError(`${c.placement.name} already has ${n} ads running then (the limit is ${c.placement.maxActive}).${next[0]?.endsAt ? ` A slot frees up after ${next[0].endsAt.toISOString().slice(0, 10)}.` : ""}`);
  }
  await db
    .update(adCampaigns)
    .set({ status: "approved", paymentReference: reference, startsAt, endsAt, reviewedById: adminId, adminNote: str(form.get("note")) || c.adminNote, updatedAt: new Date() })
    .where(eq(adCampaigns.id, id));
  await tellAdvertiser(c, "Your banner ad is approved", `It runs in "${c.placement.name}" from ${startsAt.toISOString().slice(0, 10)} to ${endsAt.toISOString().slice(0, 10)}. Thank you!`);
}

export async function rejectCampaign(id: string, note: string) {
  const c = await getCampaign(id);
  if (c.status === "approved" && c.endsAt && c.endsAt < new Date()) throw new BannerError("This ad has already finished.");
  if (!note.trim()) throw new BannerError("Say why, so the advertiser can fix it.");
  await db.update(adCampaigns).set({ status: "rejected", adminNote: note.trim(), updatedAt: new Date() }).where(eq(adCampaigns.id, id));
  await tellAdvertiser(c, "Your banner ad wasn't accepted", note.trim());
}

export async function cancelOwnCampaign(userId: string, id: string) {
  const c = await getCampaign(id);
  if (c.advertiserId !== userId) throw new BannerError("Ad not found.");
  if (!["requested", "awaiting_payment"].includes(c.status)) throw new BannerError("This ad can't be cancelled now. Contact an admin.");
  await db.update(adCampaigns).set({ status: "cancelled", updatedAt: new Date() }).where(eq(adCampaigns.id, id));
}

/** Admin loads (or replaces) the banner image and text themselves. */
export async function adminUpdateCreative(id: string, form: FormData) {
  const c = await getCampaign(id);
  const creative = await storeCreative(form.get("creative"), c.placement);
  const { headline, linkUrl } = adText(form);
  await db
    .update(adCampaigns)
    .set({
      headline,
      linkUrl,
      ...(creative ? { creativeUrl: creative.url, creativeWidth: creative.width, creativeHeight: creative.height } : {}),
      updatedAt: new Date(),
    })
    .where(eq(adCampaigns.id, id));
}

// ---------------------------------------------------------------- upload links

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Creates a one-time upload link and a 6-digit passcode for an outside advertiser, emails them
 * the link (and the passcode only if asked: otherwise give it to them by phone or SMS), and
 * returns both so the admin can see them once.
 */
export async function createUploadLink(id: string, { emailPasscode }: { emailPasscode: boolean }) {
  const c = await getCampaign(id);
  if (["approved", "rejected", "cancelled"].includes(c.status)) throw new BannerError("This ad is closed.");
  const token = randomBytes(24).toString("base64url");
  const passcode = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.update(adUploadLinks).set({ usedAt: new Date() }).where(and(eq(adUploadLinks.campaignId, c.id), isNull(adUploadLinks.usedAt)));
  await db.insert(adUploadLinks).values({ campaignId: c.id, tokenHash: sha256(token), passcodeHash: await bcrypt.hash(passcode, 8), expiresAt: new Date(Date.now() + UPLOAD_LINK_DAYS * DAY) });
  const link = `${appUrl()}/ad-upload/${token}`;
  const spec = `${c.placement.width}×${c.placement.height}px, ${formatList(c.placement.formats)}, up to ${c.placement.maxKb} KB`;
  await sendEmails([
    {
      to: c.advertiserEmail,
      subject: `Upload your banner for MyPlug ad ${c.number}`,
      text: [
        `Hi ${c.advertiserName},`,
        "",
        `Please upload the banner for your "${c.placement.name}" ad here (valid for ${UPLOAD_LINK_DAYS} days, works once):`,
        link,
        emailPasscode ? `Passcode: ${passcode}` : "We'll give you the passcode separately by phone or SMS.",
        "",
        `Banner size: ${spec}.`,
      ].join("\n"),
      html: `<div style="font-family:Arial,sans-serif;max-width:520px"><p>Hi ${escapeHtml(c.advertiserName)},</p><p>Please upload the banner for your <strong>${escapeHtml(c.placement.name)}</strong> ad. The link works once and is valid for ${UPLOAD_LINK_DAYS} days.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#ff5a4e;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">Upload your banner</a></p><p>${emailPasscode ? `Passcode: <strong style="font-size:18px;letter-spacing:3px">${passcode}</strong>` : "We'll give you the passcode separately by phone or SMS."}</p><p style="color:#777">Banner size: ${escapeHtml(spec)}. Reference: ${escapeHtml(c.number)}</p></div>`,
    },
  ]).catch((e) => console.error("Upload link email failed", e));
  return { link, passcode, emailed: EMAIL_PROVIDER_CONFIGURED };
}

async function findUploadLink(token: string) {
  if (!token || token.length < 20) return null;
  return (
    (await db.query.adUploadLinks.findFirst({
      where: and(eq(adUploadLinks.tokenHash, sha256(token)), isNull(adUploadLinks.usedAt), gt(adUploadLinks.expiresAt, new Date())),
      with: { campaign: { with: { placement: true } } },
    })) ?? null
  );
}

export async function uploadLinkState(token: string) {
  const l = await findUploadLink(token);
  if (!l || l.attempts >= MAX_PASSCODE_TRIES) return null;
  return { triesLeft: MAX_PASSCODE_TRIES - l.attempts };
}

/** Checks the passcode; wrong guesses count towards locking the link. */
export async function unlockUpload(token: string, passcode: string) {
  const l = await findUploadLink(token);
  if (!l || l.attempts >= MAX_PASSCODE_TRIES) throw new BannerError("This link has expired, been used, or been locked. Ask MyPlug for a new one.");
  if (!(await bcrypt.compare(passcode.trim(), l.passcodeHash))) {
    await db.update(adUploadLinks).set({ attempts: sql`${adUploadLinks.attempts} + 1` }).where(eq(adUploadLinks.id, l.id));
    const left = MAX_PASSCODE_TRIES - l.attempts - 1;
    throw new BannerError(left > 0 ? `Wrong passcode. ${left} tr${left === 1 ? "y" : "ies"} left.` : "Wrong passcode. This link is now locked; ask MyPlug for a new one.");
  }
  const c = l.campaign;
  return { link: l, campaign: { number: c.number, advertiserName: c.advertiserName, headline: c.headline, linkUrl: c.linkUrl, weeks: c.weeks, placement: c.placement } };
}

/** The outside advertiser supplies their banner through the link. The link then stops working. */
export async function uploadViaLink(token: string, passcode: string, form: FormData) {
  const { link } = await unlockUpload(token, passcode);
  const c = link.campaign;
  const creative = await storeCreative(form.get("creative"), c.placement);
  if (!creative) throw new BannerError("Choose your banner image.");
  const { headline, linkUrl } = adText(form);
  const [claimed] = await db.update(adUploadLinks).set({ usedAt: new Date() }).where(and(eq(adUploadLinks.id, link.id), isNull(adUploadLinks.usedAt))).returning();
  if (!claimed) throw new BannerError("This link was already used.");
  await db
    .update(adCampaigns)
    .set({ creativeUrl: creative.url, creativeWidth: creative.width, creativeHeight: creative.height, headline, linkUrl, updatedAt: new Date() })
    .where(eq(adCampaigns.id, c.id));
  await notifyAdmins({ title: "Banner uploaded by advertiser", body: `${c.number} (${c.advertiserName})`, href: `/admin/banners/${c.id}` });
}

// ---------------------------------------------------------------- showing ads

const live = () => and(eq(adCampaigns.status, "approved"), lte(adCampaigns.startsAt, sql`now()`), gte(adCampaigns.endsAt, sql`now()`));

export type LiveBanner = { id: string; creativeUrl: string; headline: string | null; width: number | null; height: number | null; hasLink: boolean };

/** Ads running now in a spot, in a fresh random order (so each advertiser gets a fair share). */
export async function liveBanners(placementKey: string, limit = 5): Promise<LiveBanner[]> {
  const rows = await db
    .select({ id: adCampaigns.id, creativeUrl: adCampaigns.creativeUrl, headline: adCampaigns.headline, width: adCampaigns.creativeWidth, height: adCampaigns.creativeHeight, linkUrl: adCampaigns.linkUrl, advertiserId: adCampaigns.advertiserId })
    .from(adCampaigns)
    .innerJoin(adPlacements, eq(adPlacements.key, adCampaigns.placementKey))
    .where(and(eq(adCampaigns.placementKey, placementKey), eq(adPlacements.isActive, true), live()))
    .orderBy(sql`random()`)
    .limit(limit);
  return rows.filter((r) => r.creativeUrl).map(({ linkUrl, advertiserId, creativeUrl, ...r }) => ({ ...r, creativeUrl: creativeUrl!, hasLink: !!linkUrl || !!advertiserId }));
}

/** One random live ad for each requested spot, leaving out spots an ad-free pass hides. */
export async function bannersFor(keys: string[], adFree: boolean) {
  const placements = await cached("ad-placements", 60_000, () => getPlacements({ activeOnly: true }));
  const out: Record<string, LiveBanner[]> = {};
  await Promise.all(
    keys.map(async (k) => {
      const p = placements.find((x) => x.key === k);
      if (!p || (adFree && p.hideableWithPass)) return;
      out[k] = await liveBanners(k, k === "hero" ? p.maxActive : 1);
    }),
  );
  return out;
}

/** Banners for a page, as the signed-in visitor should see them (ad-free pass respected). */
export async function pageBanners(request: Request, keys: string[]) {
  const user = await getUser(request);
  return bannersFor(keys, await userIsAdFree(user?.id));
}

/** Counts a click and returns where it goes: the ad's link, or the advertising merchant's store. */
export async function trackClick(id: string) {
  const [row] = await db
    .update(adCampaigns)
    .set({ clicks: sql`${adCampaigns.clicks} + 1` })
    .where(and(eq(adCampaigns.id, id), live()))
    .returning({ linkUrl: adCampaigns.linkUrl, advertiserId: adCampaigns.advertiserId });
  if (!row) return null;
  await recordAdClick(id).catch((e) => console.error("ad click analytics", e));
  return row.linkUrl ?? (await advertiserStorePath(row.advertiserId));
}

/** The store page of a merchant who booked an ad (null for customers and outside advertisers). */
async function advertiserStorePath(userId: string | null) {
  if (!userId) return null;
  const s = await db.query.stores.findFirst({ where: and(eq(stores.ownerId, userId), eq(stores.status, "approved")), columns: { slug: true } });
  return s ? `/s/${s.slug}` : null;
}

export async function userIsAdFree(userId: string | undefined) {
  if (!userId) return false;
  const u = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { adFreeUntil: true } });
  return !!u?.adFreeUntil && u.adFreeUntil > new Date();
}

// ---------------------------------------------------------------- hero panel: top 5 shops

export type TopShop = { id: string; name: string; slug: string; logoUrl: string | null; stat: string };

/** This week's 5 busiest shops (most orders) or the 5 best rated, as the admin chooses. */
export async function topShops(mode: HeroPanel): Promise<TopShop[]> {
  if (mode === "off") return [];
  return cached(`top-shops:${mode}`, 10 * 60_000, async () => {
    if (mode === "top_selling") {
      const rows = await db
        .select({ id: stores.id, name: stores.name, slug: stores.slug, logoUrl: stores.logoUrl, n: count(orders.id) })
        .from(orders)
        .innerJoin(stores, eq(stores.id, orders.storeId))
        .where(and(eq(stores.status, "approved"), ne(orders.status, "cancelled"), gte(orders.createdAt, new Date(Date.now() - 7 * DAY))))
        .groupBy(stores.id)
        .orderBy(desc(count(orders.id)))
        .limit(5);
      return rows.map(({ n, ...s }) => ({ ...s, stat: `${n} order${n === 1 ? "" : "s"} this week` }));
    }
    // Ranked by a weighted average (as if every shop had 3 extra 4-star ratings), so one
    // lucky 5-star review doesn't beat a shop with fifty 4.8s.
    const rows = await db
      .select({ id: stores.id, name: stores.name, slug: stores.slug, logoUrl: stores.logoUrl, average: avg(reviews.rating).mapWith(Number), n: count(reviews.id) })
      .from(reviews)
      .innerJoin(stores, eq(stores.id, reviews.storeId))
      .where(and(eq(stores.status, "approved"), eq(reviews.target, "store"), ne(reviews.status, "hidden")))
      .groupBy(stores.id)
      .orderBy(sql`(sum(${reviews.rating}) + 12.0) / (count(${reviews.id}) + 3) desc`)
      .limit(5);
    return rows.map(({ average, n, ...s }) => ({ ...s, stat: `★ ${average.toFixed(1)} · ${n} rating${n === 1 ? "" : "s"}` }));
  });
}

// ---------------------------------------------------------------- campaign lists

export function myCampaigns(userId: string) {
  return db.query.adCampaigns.findMany({ where: eq(adCampaigns.advertiserId, userId), orderBy: desc(adCampaigns.createdAt), with: { placement: { columns: { name: true } } } });
}

export type CampaignFilter = "action" | "live" | "all";

export function adminCampaigns(filter: CampaignFilter) {
  const where =
    filter === "action"
      ? inArray(adCampaigns.status, ["requested", "payment_submitted", "awaiting_payment"])
      : filter === "live"
        ? and(eq(adCampaigns.status, "approved"), gte(adCampaigns.endsAt, sql`now()`))
        : undefined;
  return db.query.adCampaigns.findMany({
    where,
    orderBy: [sql`case ${adCampaigns.status} when 'payment_submitted' then 0 when 'requested' then 1 when 'awaiting_payment' then 2 else 3 end`, desc(adCampaigns.createdAt)],
    limit: 200,
    with: { placement: { columns: { name: true } } },
  });
}

export async function campaignDetail(id: string) {
  const c = await db.query.adCampaigns.findFirst({
    where: eq(adCampaigns.id, id),
    with: { placement: true, advertiser: { columns: { id: true, name: true, role: true } }, uploadLinks: { orderBy: desc(adUploadLinks.createdAt), limit: 1 } },
  });
  return c ?? null;
}

// ---------------------------------------------------------------- ad-free passes

export async function adFreePrices() {
  const { adFreeCents } = await bannerSettings();
  return AD_FREE_PLANS.map((p) => ({ ...p, amountCents: Math.round((adFreeCents * p.multiplier) / 100) * 100 }));
}

export async function requestAdFree(userId: string, days: number) {
  const plan = (await adFreePrices()).find((p) => p.days === days);
  if (!plan) throw new BannerError("Choose a plan.");
  const open = await db.query.adFreePasses.findFirst({ where: and(eq(adFreePasses.userId, userId), inArray(adFreePasses.status, ["requested", "payment_submitted"])) });
  if (open) throw new BannerError("You already have a request in progress. Pay for it or wait for it to be checked.");
  const [row] = await db.insert(adFreePasses).values({ number: referenceNumber("AF"), userId, days, amountCents: plan.amountCents }).returning();
  return row;
}

export async function submitAdFreePayment(userId: string, id: string, reference: string, proofUrl: string | null) {
  if (!reference.trim() && !proofUrl) throw new BannerError("Enter the payment reference or attach proof of payment.");
  const [row] = await db
    .update(adFreePasses)
    .set({ status: "payment_submitted", paymentReference: reference.trim() || null, proofUrl })
    .where(and(eq(adFreePasses.id, id), eq(adFreePasses.userId, userId), eq(adFreePasses.status, "requested")))
    .returning();
  if (!row) throw new BannerError("This request isn't waiting for payment.");
  await notifyAdmins({ title: "Ad-free pass payment to check", body: `${row.number}: ${reference.trim() || "proof attached"}`, href: "/admin/banners?tab=passes" });
}

/** Admin confirms payment: the pass extends any time already remaining. */
export async function decideAdFree(id: string, approve: boolean) {
  const pass = await db.query.adFreePasses.findFirst({ where: eq(adFreePasses.id, id) });
  if (!pass || !["requested", "payment_submitted"].includes(pass.status)) throw new BannerError("This pass has already been decided.");
  await db.update(adFreePasses).set({ status: approve ? "approved" : "rejected", reviewedAt: new Date() }).where(eq(adFreePasses.id, id));
  if (!approve) {
    await notify([pass.userId], { title: "Ad-free pass not approved", body: "We couldn't confirm your payment. Contact support if you've paid.", href: "/account/ad-free" });
    return;
  }
  const u = await db.query.users.findFirst({ where: eq(users.id, pass.userId), columns: { adFreeUntil: true } });
  const from = u?.adFreeUntil && u.adFreeUntil > new Date() ? u.adFreeUntil : new Date();
  const until = new Date(from.getTime() + pass.days * DAY);
  await db.update(users).set({ adFreeUntil: until }).where(eq(users.id, pass.userId));
  await notify([pass.userId], { title: "Ad-free browsing is on", body: `Side and in-page banners are hidden until ${until.toISOString().slice(0, 10)}.`, href: "/account/ad-free" });
}

export function myPasses(userId: string) {
  return db.query.adFreePasses.findMany({ where: eq(adFreePasses.userId, userId), orderBy: desc(adFreePasses.createdAt), limit: 20 });
}

export function adminPasses() {
  return db.query.adFreePasses.findMany({
    orderBy: [sql`case ${adFreePasses.status} when 'payment_submitted' then 0 when 'requested' then 1 else 2 end`, desc(adFreePasses.createdAt)],
    limit: 100,
    with: { user: { columns: { id: true, name: true, email: true } } },
  });
}

export async function bannerCounts() {
  const [[campaigns], [passes]] = await Promise.all([
    db.select({ n: count() }).from(adCampaigns).where(inArray(adCampaigns.status, ["requested", "payment_submitted"])),
    db.select({ n: count() }).from(adFreePasses).where(eq(adFreePasses.status, "payment_submitted")),
  ]);
  return campaigns.n + passes.n;
}
