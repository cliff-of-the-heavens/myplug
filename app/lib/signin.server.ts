import type { User } from "~/db/schema";
import { eq } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { createUserSession, safeRedirect, startMfaChallenge, touchActivity } from "./auth.server";
import { hasAuthenticator, MfaError, needsChallenge, sendEmailCode } from "./mfa.server";
import { restoreArchivedStore } from "./retention.server";

/**
 * The password or Google/Facebook sign-in succeeded. People with two-step sign-in (and every admin
 * in production) go on to enter a code; everyone else is signed in now.
 */
export async function finishSignIn(request: Request, user: Pick<User, "id" | "role">, redirectTo: FormDataEntryValue | string | null) {
  if (!(await needsChallenge(user))) return completeSignIn(request, user, redirectTo);

  const person = await db.query.users.findFirst({ where: eq(schema.users.id, user.id), columns: { id: true, email: true, name: true } });
  let flash: { tone: "success" | "warning"; text: string } | null = null;
  // Someone with an authenticator app needn't wait for an email; they can still ask for one.
  if (person && !(await hasAuthenticator(user.id))) {
    try {
      const { devCode } = await sendEmailCode(person, "login");
      if (devCode) flash = { tone: "success", text: `Development only (no email service set up): your code is ${devCode}` };
    } catch (e) {
      if (!(e instanceof MfaError)) throw e;
      flash = { tone: "warning", text: e.message };
    }
  }
  return startMfaChallenge(request, { userId: user.id, redirectTo: typeof redirectTo === "string" ? redirectTo : "" }, flash);
}

/** Starts the session and sends the person to the right place. */
export async function completeSignIn(
  request: Request,
  user: Pick<User, "id" | "role">,
  redirectTo: FormDataEntryValue | string | null,
  { mfaVerified = false } = {},
) {
  await touchActivity(user.id);
  // A merchant coming back to an inactive (archived) store gets it back straight away.
  if (user.role === "merchant") await restoreArchivedStore(user.id);

  // Merchants and admins land on their dashboards unless they were heading somewhere specific.
  const home = { merchant: "/sell", admin: "/admin", courier: "/courier", customer: "/" }[user.role];
  const target = safeRedirect(redirectTo, home);
  return createUserSession(request, user.id, target === "/" ? home : target, { mfaVerified });
}
