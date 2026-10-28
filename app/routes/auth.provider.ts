import { redirect } from "react-router";
import { getUser, safeRedirect, startOAuth } from "~/lib/auth.server";
import { authorizeUrl, callbackUrl, isProvider, newState } from "~/lib/oauth.server";
import type { Route } from "./+types/auth.provider";

/** "Continue with Google/Facebook": remembers where the person was going, then sends them to the provider. */
export async function loader({ request, params }: Route.LoaderArgs) {
  if (await getUser(request)) throw redirect("/");
  const provider = params.provider;
  if (!isProvider(provider)) throw redirect(`/login?${new URLSearchParams({ error: "That sign-in option isn't available." })}`);
  const url = new URL(request.url);
  const state = newState();
  return startOAuth(
    request,
    {
      state,
      provider,
      role: url.searchParams.get("role") ?? "customer",
      redirectTo: safeRedirect(url.searchParams.get("redirectTo"), "/"),
      devEmail: provider === "dev" ? (url.searchParams.get("devEmail") ?? undefined) : undefined,
    },
    authorizeUrl(provider, callbackUrl(request, provider), state),
  );
}
