import { and, eq } from "drizzle-orm";
import { redirect } from "react-router";
import { db, schema } from "~/db/client.server";
import { startSocialSignup, takeOAuthState } from "~/lib/auth.server";
import { callbackUrl, fetchProfile, isProvider, OAuthError } from "~/lib/oauth.server";
import { finishSignIn } from "~/lib/signin.server";
import type { Route } from "./+types/auth.callback";

const { users, userIdentities } = schema;

/**
 * Google/Facebook send the person back here. Someone who signed in this way before, or whose
 * confirmed email matches an account, is signed in. Anyone new finishes on the sign-up form.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const { oauth, cookie } = await takeOAuthState(request);
  const fail = (error: string) => redirect(`/login?${new URLSearchParams({ error })}`, { headers: { "Set-Cookie": cookie } });

  const provider = params.provider;
  if (!isProvider(provider) || !oauth || oauth.provider !== provider || oauth.state !== url.searchParams.get("state")) {
    return fail("That sign-in didn't work or took too long. Please try again.");
  }
  if (url.searchParams.get("error") || !url.searchParams.get("code")) return fail("Sign-in was cancelled.");

  let profile;
  try {
    profile = await fetchProfile(provider, url.searchParams.get("code")!, callbackUrl(request, provider), oauth.devEmail);
  } catch (e) {
    if (e instanceof OAuthError) return fail(e.message);
    throw e;
  }

  const identity = await db.query.userIdentities.findFirst({
    where: and(eq(userIdentities.provider, provider), eq(userIdentities.providerUserId, profile.id)),
  });
  let user = identity ? await db.query.users.findFirst({ where: eq(users.id, identity.userId) }) : undefined;
  // Same confirmed email as an existing account: it's the same person, so link the two.
  if (!user && profile.email && profile.emailVerified) {
    user = await db.query.users.findFirst({ where: eq(users.email, profile.email) });
    if (user) await db.insert(userIdentities).values({ userId: user.id, provider, providerUserId: profile.id, email: profile.email });
  }
  if (user) {
    if (user.status !== "active") return fail("This account has been suspended. Contact support.");
    return finishSignIn(request, user, oauth.redirectTo);
  }

  const next = new URLSearchParams({ role: oauth.role, redirectTo: oauth.redirectTo });
  return startSocialSignup(request, profile, `/register?${next}`);
}
