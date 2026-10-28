import type { User } from "~/db/schema";
import { createUserSession, safeRedirect, touchActivity } from "./auth.server";
import { restoreArchivedStore } from "./retention.server";

/** Signs a checked user in (password or Google/Facebook) and sends them to the right place. */
export async function finishSignIn(request: Request, user: Pick<User, "id" | "role">, redirectTo: FormDataEntryValue | string | null) {
  await touchActivity(user.id);
  // A merchant coming back to an inactive (archived) store gets it back straight away.
  if (user.role === "merchant") await restoreArchivedStore(user.id);

  // Merchants and admins land on their dashboards unless they were heading somewhere specific.
  const home = { merchant: "/sell", admin: "/admin", courier: "/courier", customer: "/" }[user.role];
  const target = safeRedirect(redirectTo, home);
  return createUserSession(request, user.id, target === "/" ? home : target);
}
