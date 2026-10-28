import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { createCookieSessionStorage, redirect } from "react-router";
import { db, schema } from "~/db/client.server";
import type { StoreStatus, User } from "~/db/schema";
import type { PendingSocial, ProviderId } from "./oauth";

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("SESSION_SECRET must be set and at least 32 characters long.");
}

/** A Google/Facebook sign-in in progress: checked when the provider sends the person back. */
type OAuthState = { state: string; provider: ProviderId; role: string; redirectTo: string; devEmail?: string };

// issuedAt: when this sign-in happened, so changing the password can sign out older sessions.
// socialPending: a new Google/Facebook user who still has to finish signing up.
const sessionStorage = createCookieSessionStorage<
  { userId: string; issuedAt: number; oauth: OAuthState; socialPending: PendingSocial },
  { flash: string }
>({
  cookie: {
    name: "__myplug",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    secrets: [secret],
    maxAge: 60 * 60 * 24 * 30,
  },
});

export type SessionUser = Pick<User, "id" | "email" | "name" | "role" | "status"> & {
  storeId: string | null;
  storeSlug: string | null;
  courierId: string | null;
  courierStatus: "pending" | "approved" | "rejected" | "suspended" | null;
  termsVersion: string | null;
  storeCurrency: string | null;
  storeStatus: StoreStatus | null;
  isTradesperson: boolean; // a handyman: their store is a tradesperson's profile
};

export function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyLogin(email: string, password: string) {
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email.toLowerCase()) });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

const ACTIVITY_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function touchActivity(userId: string) {
  await db.update(schema.users).set({ lastActiveAt: new Date() }).where(eq(schema.users.id, userId));
}

/** Returns the signed-in user, or null for guests. Suspended users are treated as signed out. */
export async function getUser(request: Request): Promise<SessionUser | null> {
  const session = await getSession(request);
  const userId = session.get("userId");
  if (!userId) return null;

  const row = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { id: true, email: true, name: true, role: true, status: true, lastActiveAt: true, termsVersion: true, passwordChangedAt: true },
    with: {
      store: { columns: { id: true, slug: true, currency: true, status: true, isTradesperson: true } },
      courier: { columns: { id: true, status: true } },
    },
  });
  if (!row || row.status !== "active") return null;
  // Signed in before the password was last changed (e.g. on a lost phone): no longer valid.
  if (row.passwordChangedAt && (session.get("issuedAt") ?? 0) < row.passwordChangedAt.getTime()) return null;

  // Activity keeps stores from being archived as inactive; record it at most every few hours.
  if (Date.now() - row.lastActiveAt.getTime() > ACTIVITY_INTERVAL_MS) await touchActivity(row.id);

  const { store, courier, lastActiveAt: _, passwordChangedAt: __, ...user } = row;
  return {
    ...user,
    storeId: store?.id ?? null,
    storeSlug: store?.slug ?? null,
    storeCurrency: store?.currency ?? null,
    storeStatus: store?.status ?? null,
    isTradesperson: store?.isTradesperson ?? false,
    courierId: courier?.id ?? null,
    courierStatus: courier?.status ?? null,
  };
}

/** Sends guests to the home page with the sign-in pop-up open, returning them here afterwards. */
function loginRedirect(request: Request) {
  const url = new URL(request.url);
  const params = new URLSearchParams({ auth: "login", redirectTo: url.pathname + url.search });
  return redirect(`/?${params}`);
}

export async function requireUser(request: Request) {
  const user = await getUser(request);
  if (!user) throw loginRedirect(request);
  return user;
}

export async function requireCustomer(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "customer") {
    throw new Response("Only customer accounts can do this.", { status: 403 });
  }
  return user;
}

type MerchantUser = SessionUser & { storeId: string; storeSlug: string; storeCurrency: string; storeStatus: StoreStatus };

/** Any merchant, whatever their store's approval status. */
export async function requireMerchantAccount(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "merchant" || !user.storeId) {
    throw new Response("Only merchant accounts can access this.", { status: 403 });
  }
  return user as MerchantUser;
}

/** A merchant whose store an admin has approved. Others are sent to the approval status page. */
export async function requireMerchant(request: Request) {
  const user = await requireMerchantAccount(request);
  if (user.storeStatus !== "approved") throw redirect("/sell/pending");
  return user;
}

/** A courier account (any review status: pending couriers can still complete their profile). */
export async function requireCourier(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "courier" || !user.courierId) throw new Response("Only courier accounts can access this.", { status: 403 });
  return user as SessionUser & { courierId: string };
}

export async function requireAdmin(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "admin") throw new Response("Admins only.", { status: 403 });
  return user;
}

export async function createUserSession(request: Request, userId: string, redirectTo: string) {
  const session = await getSession(request);
  session.set("userId", userId);
  session.set("issuedAt", Date.now());
  session.unset("oauth");
  session.unset("socialPending");
  return redirect(safeRedirect(redirectTo), {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

export type Flash = { tone: "success" | "warning"; text: string };

/**
 * Keeps the current session valid after its own password change (which signs out every session
 * started before it), then redirects with a one-time message.
 */
export async function refreshSession(request: Request, to: string, flash: Flash) {
  const session = await getSession(request);
  session.set("issuedAt", Date.now());
  session.flash("flash", JSON.stringify(flash));
  return redirect(to, { headers: { "Set-Cookie": await sessionStorage.commitSession(session) } });
}

/** Redirects and shows a one-time message on the next page (kept in the session, not the URL). */
export async function redirectWithFlash(request: Request, to: string, flash: Flash) {
  const session = await getSession(request);
  session.flash("flash", JSON.stringify(flash));
  return redirect(to, { headers: { "Set-Cookie": await sessionStorage.commitSession(session) } });
}

/** Reads (and clears) the one-time message. Return `headers` from the loader so it's cleared. */
export async function getFlash(request: Request) {
  const session = await getSession(request);
  const raw = session.get("flash");
  let flash: Flash | null = null;
  try {
    flash = raw ? (JSON.parse(raw) as Flash) : null;
  } catch {}
  return { flash, headers: { "Set-Cookie": await sessionStorage.commitSession(session) } };
}

export async function logout(request: Request) {
  const session = await getSession(request);
  return redirect("/", { headers: { "Set-Cookie": await sessionStorage.destroySession(session) } });
}

/** Prevents open redirects: only allow same-site relative paths. */
export function safeRedirect(to: FormDataEntryValue | string | null | undefined, fallback = "/") {
  if (!to || typeof to !== "string" || !to.startsWith("/") || to.startsWith("//")) return fallback;
  return to;
}

/**
 * The signed-in user's id straight from the session cookie, without a database lookup.
 * Only for low-stakes uses like analytics; anything that grants access must use getUser.
 */
export async function sessionUserId(request: Request) {
  const session = await getSession(request);
  return session.get("userId") ?? null;
}

// ---------------------------------------------------------------- Google / Facebook sign-in

/** Remembers a sign-in that's on its way to Google/Facebook, then sends the person there. */
export async function startOAuth(request: Request, oauth: OAuthState, to: string) {
  const session = await getSession(request);
  session.set("oauth", oauth);
  return redirect(to, { headers: { "Set-Cookie": await sessionStorage.commitSession(session) } });
}

/** The sign-in started here (and only once: it's cleared as it's read). */
export async function takeOAuthState(request: Request) {
  const session = await getSession(request);
  const oauth = session.get("oauth") ?? null;
  session.unset("oauth");
  return { oauth, cookie: await sessionStorage.commitSession(session) };
}

/** Sends a new Google/Facebook user to the sign-up form to finish (role, terms, store details). */
export async function startSocialSignup(request: Request, pending: PendingSocial, to: string) {
  const session = await getSession(request);
  session.unset("oauth");
  session.set("socialPending", pending);
  return redirect(to, { headers: { "Set-Cookie": await sessionStorage.commitSession(session) } });
}

export async function getSocialPending(request: Request) {
  return (await getSession(request)).get("socialPending") ?? null;
}

/** "Not you?" on the sign-up form: forget the Google/Facebook account. */
export async function clearSocialPending(request: Request, to: string) {
  const session = await getSession(request);
  session.unset("socialPending");
  return redirect(to, { headers: { "Set-Cookie": await sessionStorage.commitSession(session) } });
}
