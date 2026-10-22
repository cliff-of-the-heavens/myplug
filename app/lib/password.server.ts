import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { hashPassword } from "./auth.server";
import { appUrl, EMAIL_PROVIDER_CONFIGURED, escapeHtml, sendEmails } from "./email.server";
import { MIN_PASSWORD } from "./password";

const { users, passwordResets } = schema;

export class PasswordError extends Error {}

const RESET_MINUTES = 60;
const MAX_REQUESTS_PER_HOUR = 3;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function checkNewPassword(password: string, confirm: string) {
  if (password.length < MIN_PASSWORD) throw new PasswordError(`Use at least ${MIN_PASSWORD} characters.`);
  if (password.length > 200) throw new PasswordError("That password is too long.");
  if (password !== confirm) throw new PasswordError("The two passwords don't match.");
}

/**
 * Emails a one-time reset link. Always behaves the same whether or not the email has an
 * account, so the form can't be used to find out who's registered. Returns the link only in
 * local development without an email provider, so it can be tested.
 */
export async function requestPasswordReset(email: string) {
  const user = await db.query.users.findFirst({ where: eq(users.email, email.trim().toLowerCase()), columns: { id: true, name: true, email: true, status: true } });
  if (!user || user.status !== "active") return { devLink: null };

  // A few requests an hour at most, so nobody can flood someone's inbox.
  const recent = await db
    .select({ id: passwordResets.id })
    .from(passwordResets)
    .where(and(eq(passwordResets.userId, user.id), gt(passwordResets.createdAt, new Date(Date.now() - 3_600_000))));
  if (recent.length >= MAX_REQUESTS_PER_HOUR) return { devLink: null };

  const token = randomBytes(32).toString("base64url");
  await db.insert(passwordResets).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) });
  const link = `${appUrl()}/reset-password?token=${token}`;
  await sendEmails([
    {
      to: user.email,
      subject: "Reset your MyPlug password",
      text: [`Hi ${user.name},`, "", "Use this link to choose a new password. It works once, for the next hour:", link, "", "If you didn't ask for this, ignore this email: your password stays the same."].join("\n"),
      html: `<div style="font-family:Arial,sans-serif;max-width:520px"><p>Hi ${escapeHtml(user.name)},</p><p>Use this button to choose a new password. It works once, for the next hour.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#ff5a4e;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">Choose a new password</a></p><p style="color:#777;font-size:13px">If you didn't ask for this, ignore this email: your password stays the same.</p></div>`,
    },
  ]);
  const devLink = !EMAIL_PROVIDER_CONFIGURED && process.env.NODE_ENV !== "production" ? link : null;
  if (devLink) console.info(`[password reset link, development only] ${link}`);
  return { devLink };
}

/** The account a reset link belongs to, if the link is still valid. */
export async function findResetToken(token: string) {
  if (!token || token.length < 20) return null;
  const row = await db.query.passwordResets.findFirst({
    where: and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())),
  });
  return row ?? null;
}

/** Sets a new password and signs out every existing session of that account. */
async function setPassword(userId: string, password: string) {
  const now = new Date();
  await db.update(users).set({ passwordHash: await hashPassword(password), passwordChangedAt: now, updatedAt: now }).where(eq(users.id, userId));
  // Any other outstanding reset links stop working too.
  await db.update(passwordResets).set({ usedAt: now }).where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)));
  const u = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { email: true, name: true } });
  if (u) {
    await sendEmails([
      {
        to: u.email,
        subject: "Your MyPlug password was changed",
        text: `Hi ${u.name},\n\nYour MyPlug password was just changed and other devices were signed out.\nIf this wasn't you, reset your password straight away at ${appUrl()}/forgot-password and contact support.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px"><p>Hi ${escapeHtml(u.name)},</p><p>Your MyPlug password was just changed and other devices were signed out.</p><p>If this wasn't you, <a href="${escapeHtml(appUrl())}/forgot-password">reset your password</a> straight away and contact support.</p></div>`,
      },
    ]);
  }
}

/** Forgot password: sets the new password using a valid, unused link. */
export async function resetPassword(token: string, password: string, confirm: string) {
  checkNewPassword(password, confirm);
  const row = await findResetToken(token);
  if (!row) throw new PasswordError("This reset link has expired or was already used. Ask for a new one.");
  // Claim the link first so it can't be used twice at the same moment.
  const [claimed] = await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResets.id, row.id), isNull(passwordResets.usedAt)))
    .returning();
  if (!claimed) throw new PasswordError("This reset link was already used. Ask for a new one.");
  await setPassword(row.userId, password);
  return row.userId;
}

/** Signed-in user changes their password; they must know the current one. */
export async function changePassword(userId: string, current: string, password: string, confirm: string) {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { passwordHash: true } });
  if (!u || !(await bcrypt.compare(current, u.passwordHash))) throw new PasswordError("Your current password isn't right.");
  checkNewPassword(password, confirm);
  if (await bcrypt.compare(password, u.passwordHash)) throw new PasswordError("Choose a password different from your current one.");
  await setPassword(userId, password);
}
