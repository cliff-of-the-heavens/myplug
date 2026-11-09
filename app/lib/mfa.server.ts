import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { db, schema } from "~/db/client.server";
import type { User } from "~/db/schema";
import { ADMIN_MFA_REQUIRED } from "./auth.server";
import { EMAIL_PROVIDER_CONFIGURED, sendEmails } from "./email.server";
import { renderEmail } from "./email-template.server";
import { decryptSecret, encryptSecret } from "./storage.server";

const { userMfa, otpCodes } = schema;

export class MfaError extends Error {}

export type OtpPurpose = "login" | "enable" | "disable";
type Person = Pick<User, "id" | "email" | "name">;

const CODE_MINUTES = 10;
const MAX_SENDS_PER_HOUR = 5;
const RESEND_SECONDS = 45;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const TOTP_PERIOD = 30;
const TOTP_WINDOW = 1; // accept the codes either side of now, for clocks that are slightly off

const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const hashCode = (userId: string, purpose: OtpPurpose, code: string) =>
  createHmac("sha256", process.env.SESSION_SECRET!).update(`otp:${userId}:${purpose}:${code}`).digest("hex");

// ---------------------------------------------------------------- who needs it

export function mfaMandatory(role: User["role"]) {
  return role === "admin" && ADMIN_MFA_REQUIRED;
}

async function mfaRow(userId: string) {
  await db.insert(userMfa).values({ userId }).onConflictDoNothing();
  const row = await db.query.userMfa.findFirst({ where: eq(userMfa.userId, userId) });
  return row!;
}

export async function needsChallenge(user: Pick<User, "id" | "role">) {
  if (mfaMandatory(user.role)) return true;
  const row = await db.query.userMfa.findFirst({ where: eq(userMfa.userId, user.id), columns: { enabled: true } });
  return !!row?.enabled;
}

export async function hasAuthenticator(userId: string) {
  const row = await db.query.userMfa.findFirst({ where: eq(userMfa.userId, userId), columns: { totpSecret: true } });
  return !!row?.totpSecret;
}

export async function mfaSettings(userId: string) {
  const row = await db.query.userMfa.findFirst({ where: eq(userMfa.userId, userId) });
  return { enabled: !!row?.enabled, hasTotp: !!row?.totpSecret, pendingSecret: row?.totpPendingSecret ?? null };
}

// ---------------------------------------------------------------- emailed codes

/** Emails a new code, replacing any earlier one for the same purpose. Development without email gets it back. */
export async function sendEmailCode(user: Person, purpose: OtpPurpose) {
  if (!EMAIL_PROVIDER_CONFIGURED && process.env.NODE_ENV === "production") {
    throw new MfaError("Email isn't set up on this site, so a code can't be sent. Set RESEND_API_KEY and EMAIL_FROM.");
  }
  const recent = await db
    .select({ createdAt: otpCodes.createdAt })
    .from(otpCodes)
    .where(and(eq(otpCodes.userId, user.id), gt(otpCodes.createdAt, new Date(Date.now() - 3_600_000))))
    .orderBy(desc(otpCodes.createdAt));
  if (recent.length >= MAX_SENDS_PER_HOUR) throw new MfaError("Too many codes requested. Please try again in an hour.");
  const wait = recent[0] ? Math.ceil(RESEND_SECONDS - (Date.now() - recent[0].createdAt.getTime()) / 1000) : 0;
  if (wait > 0) throw new MfaError(`A code was just sent. You can ask for another in ${wait} seconds.`);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.update(otpCodes).set({ usedAt: new Date() }).where(and(eq(otpCodes.userId, user.id), eq(otpCodes.purpose, purpose), isNull(otpCodes.usedAt)));
  await db.insert(otpCodes).values({ userId: user.id, purpose, codeHash: hashCode(user.id, purpose, code), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) });

  const action = { login: "sign in to MyPlug", enable: "turn on two-step sign-in", disable: "change your two-step sign-in" }[purpose];
  const [result] = await sendEmails([
    {
      to: user.email,
      subject: "Your MyPlug security code",
      text: `Hi ${user.name},\n\nYour code to ${action} is ${code}. It works once, for the next ${CODE_MINUTES} minutes.\n\nIf you didn't ask for this, someone may know your password: change it straight away.`,
      html: renderEmail({
        preview: `Your code to ${action}. It works for ${CODE_MINUTES} minutes.`,
        eyebrow: "Security code",
        title: "Here's your code",
        greeting: user.name,
        paragraphs: [`Enter this code to ${action}. It works once, for the next ${CODE_MINUTES} minutes.`],
        code,
        note: "Never share this code with anyone. If you didn't ask for it, someone may know your password: change it straight away.",
      }),
    },
  ]);
  if (!result.ok) {
    console.error(`[two-step code not sent] ${result.error}`);
    throw new MfaError("We couldn't send the code. Please try again shortly.");
  }
  if (EMAIL_PROVIDER_CONFIGURED) return { devCode: null };
  console.info(`[two-step code, development only] ${user.email}: ${code}`);
  return { devCode: code };
}

async function matchEmailCode(userId: string, purpose: OtpPurpose, code: string) {
  const row = await db.query.otpCodes.findFirst({
    where: and(eq(otpCodes.userId, userId), eq(otpCodes.purpose, purpose), isNull(otpCodes.usedAt), gt(otpCodes.expiresAt, new Date())),
    orderBy: desc(otpCodes.createdAt),
  });
  if (!row || !equal(row.codeHash, hashCode(userId, purpose, code))) return false;
  // Claimed atomically so the same code can't be used twice at the same moment.
  const claimed = await db.update(otpCodes).set({ usedAt: new Date() }).where(and(eq(otpCodes.id, row.id), isNull(otpCodes.usedAt))).returning({ id: otpCodes.id });
  return claimed.length === 1;
}

// ---------------------------------------------------------------- authenticator apps (RFC 6238)

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toBase32(data: Buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return bits ? out + BASE32[(value << (5 - bits)) & 31] : out;
}

function totpCode(secret: Buffer, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** The time step this code belongs to (near now), or null. */
function matchingStep(secret: Buffer, code: string) {
  const now = Math.floor(Date.now() / 1000 / TOTP_PERIOD);
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step++) {
    if (equal(totpCode(secret, step), code)) return step;
  }
  return null;
}

/** A stored secret as raw bytes, or null if it can't be read (SESSION_SECRET changed). */
function readSecret(stored: string | null) {
  const plain = stored ? decryptSecret(stored) : "";
  return plain ? Buffer.from(plain, "base64url") : null;
}

async function matchAuthenticator(row: typeof userMfa.$inferSelect, code: string) {
  const secret = readSecret(row.totpSecret);
  const step = secret && matchingStep(secret, code);
  if (!step) return false;
  // Recording the step atomically means a code can't be replayed.
  const claimed = await db
    .update(userMfa)
    .set({ totpLastStep: step })
    .where(and(eq(userMfa.userId, row.userId), or(isNull(userMfa.totpLastStep), lt(userMfa.totpLastStep, step))))
    .returning({ id: userMfa.userId });
  return claimed.length === 1;
}

export async function startAuthenticatorSetup(userId: string) {
  await mfaRow(userId);
  await db.update(userMfa).set({ totpPendingSecret: encryptSecret(randomBytes(20).toString("base64url")) }).where(eq(userMfa.userId, userId));
}

export async function cancelAuthenticatorSetup(userId: string) {
  await db.update(userMfa).set({ totpPendingSecret: null }).where(eq(userMfa.userId, userId));
}

/** What the person needs to add MyPlug to their app: a QR code, or a key to type in. */
export async function authenticatorSetupDetails(email: string, pending: string) {
  const secret = readSecret(pending);
  if (!secret) return null;
  const key = toBase32(secret);
  const uri = `otpauth://totp/MyPlug:${encodeURIComponent(email)}?secret=${key}&issuer=MyPlug&algorithm=SHA1&digits=6&period=${TOTP_PERIOD}`;
  const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { key: key.match(/.{1,4}/g)!.join(" "), qr: `data:image/svg+xml,${encodeURIComponent(svg)}` };
}

export async function confirmAuthenticator(user: Person, rawCode: string) {
  const row = await assertNotLocked(user.id);
  const secret = readSecret(row.totpPendingSecret);
  const code = rawCode.replace(/\s/g, "");
  const step = secret && /^\d{6}$/.test(code) ? matchingStep(secret, code) : null;
  if (!step) throw await recordFailure(user.id);
  await db
    .update(userMfa)
    .set({ totpSecret: row.totpPendingSecret, totpPendingSecret: null, totpLastStep: step, enabled: true, failures: 0, lockedUntil: null })
    .where(eq(userMfa.userId, user.id));
  await sendNotice(user, "An authenticator app was added to your account. You can now use it to sign in.");
}

// ---------------------------------------------------------------- checking a code

async function assertNotLocked(userId: string) {
  const row = await mfaRow(userId);
  if (!row.lockedUntil) return row;
  const left = row.lockedUntil.getTime() - Date.now();
  if (left > 0) throw new MfaError(`Too many wrong codes. Please try again in ${Math.ceil(left / 60_000)} minutes.`);
  await db.update(userMfa).set({ failures: 0, lockedUntil: null }).where(eq(userMfa.userId, userId));
  return { ...row, failures: 0, lockedUntil: null };
}

async function recordFailure(userId: string) {
  const [row] = await db
    .update(userMfa)
    .set({
      failures: sql`${userMfa.failures} + 1`,
      lockedUntil: sql`CASE WHEN ${userMfa.failures} + 1 >= ${MAX_FAILURES} THEN now() + make_interval(mins => ${LOCK_MINUTES}) ELSE ${userMfa.lockedUntil} END`,
    })
    .where(eq(userMfa.userId, userId))
    .returning({ failures: userMfa.failures });
  return new MfaError(
    row && row.failures >= MAX_FAILURES ? `Too many wrong codes. Please try again in ${LOCK_MINUTES} minutes.` : "That code isn't right, or it has expired.",
  );
}

/**
 * Checks a code from email (for this purpose) or, unless told otherwise, the authenticator app.
 * Five wrong codes lock further tries for 15 minutes. Throws MfaError when it doesn't match.
 */
export async function checkCode(userId: string, rawCode: string, purpose: OtpPurpose, { allowAuthenticator = true } = {}) {
  const row = await assertNotLocked(userId);
  const code = rawCode.replace(/\s/g, "");
  const ok = /^\d{6}$/.test(code) && ((allowAuthenticator && (await matchAuthenticator(row, code))) || (await matchEmailCode(userId, purpose, code)));
  if (!ok) throw await recordFailure(userId);
  await db.update(userMfa).set({ failures: 0, lockedUntil: null }).where(eq(userMfa.userId, userId));
}

// ---------------------------------------------------------------- turning it on and off

async function sendNotice(user: Person, message: string) {
  await sendEmails([
    {
      to: user.email,
      subject: "Your MyPlug sign-in security changed",
      text: `Hi ${user.name},\n\n${message}\n\nIf this wasn't you, change your password straight away and contact support.`,
      html: renderEmail({
        preview: message,
        eyebrow: "Account security",
        title: "Your sign-in security changed",
        greeting: user.name,
        paragraphs: [message],
        note: "If this wasn't you, change your password straight away and contact support.",
      }),
    },
  ]);
}

export async function enableEmailMfa(user: Person, code: string) {
  await checkCode(user.id, code, "enable", { allowAuthenticator: false });
  await db.update(userMfa).set({ enabled: true }).where(eq(userMfa.userId, user.id));
  await sendNotice(user, "Two-step sign-in was turned on. You'll be asked for a code each time you sign in.");
}

export async function disableMfa(user: Person & Pick<User, "role">, code: string) {
  if (mfaMandatory(user.role)) throw new MfaError("Two-step sign-in is required for admin accounts.");
  await checkCode(user.id, code, "disable");
  await db.update(userMfa).set({ enabled: false, totpSecret: null, totpPendingSecret: null, totpLastStep: null }).where(eq(userMfa.userId, user.id));
  await sendNotice(user, "Two-step sign-in was turned off. You'll sign in with just your password.");
}

export async function removeAuthenticator(user: Person, code: string) {
  await checkCode(user.id, code, "disable");
  await db.update(userMfa).set({ totpSecret: null, totpPendingSecret: null, totpLastStep: null }).where(eq(userMfa.userId, user.id));
  await sendNotice(user, "The authenticator app was removed from your account. Sign-in codes will now come by email.");
}

/** Emailed codes are only needed for a short while; older rows are cleared by the daily job. */
export async function purgeOldCodes() {
  await db.delete(otpCodes).where(lt(otpCodes.createdAt, new Date(Date.now() - 86_400_000)));
}

/** j***@example.com: enough to recognise, without showing the whole address before sign-in is finished. */
export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
