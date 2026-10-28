import { randomBytes } from "node:crypto";
import type { PendingSocial, ProviderId } from "./oauth";

/**
 * Sign in with Google or Facebook (OAuth 2.0 authorization code flow). Each provider is switched on
 * by setting its app keys; without them its button doesn't show.
 */
/** Who the provider says the person is. emailVerified: the provider has confirmed the address. */
export type SocialProfile = PendingSocial;

export class OAuthError extends Error {}

const FACEBOOK_API = "https://graph.facebook.com/v21.0";

const env = (k: string) => process.env[k]?.trim() || "";

/** Pretend provider for trying the flow locally without real app keys (never in production). */
const devEnabled = () => process.env.NODE_ENV !== "production" && env("OAUTH_DEV_MOCK") === "1";

export function enabledProviders(): ProviderId[] {
  const out: ProviderId[] = [];
  if (env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET")) out.push("google");
  if (env("FACEBOOK_APP_ID") && env("FACEBOOK_APP_SECRET")) out.push("facebook");
  if (devEnabled()) out.push("dev");
  return out;
}

export function isProvider(p: string | undefined): p is ProviderId {
  return !!p && (enabledProviders() as string[]).includes(p);
}

export function newState() {
  return randomBytes(24).toString("base64url");
}

/** The address the provider sends people back to; it must be registered in the provider's app settings. */
export function callbackUrl(request: Request, provider: ProviderId) {
  const base = env("APP_URL") || new URL(request.url).origin;
  return `${base.replace(/\/$/, "")}/auth/${provider}/callback`;
}

export function authorizeUrl(provider: ProviderId, redirectUri: string, state: string) {
  if (provider === "google") {
    return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    })}`;
  }
  if (provider === "facebook") {
    return `https://www.facebook.com/v21.0/dialog/oauth?${new URLSearchParams({
      client_id: env("FACEBOOK_APP_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "email,public_profile",
      state,
    })}`;
  }
  return `${redirectUri}?${new URLSearchParams({ code: "dev", state })}`;
}

async function json(res: Response, what: string) {
  if (!res.ok) throw new OAuthError(`${what} failed (${res.status}). Please try again.`);
  return (await res.json()) as Record<string, unknown>;
}

/** Swaps the one-time code for the person's profile. */
export async function fetchProfile(provider: ProviderId, code: string, redirectUri: string, devEmail?: string): Promise<SocialProfile> {
  if (provider === "google") {
    const token = await json(
      await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env("GOOGLE_CLIENT_ID"),
          client_secret: env("GOOGLE_CLIENT_SECRET"),
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      }),
      "Google sign-in",
    );
    const info = await json(
      await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } }),
      "Reading your Google profile",
    );
    return {
      provider,
      id: String(info.sub),
      email: typeof info.email === "string" ? info.email.toLowerCase() : null,
      emailVerified: info.email_verified === true,
      name: String(info.name ?? info.given_name ?? ""),
    };
  }
  if (provider === "facebook") {
    const token = await json(
      await fetch(
        `${FACEBOOK_API}/oauth/access_token?${new URLSearchParams({
          client_id: env("FACEBOOK_APP_ID"),
          client_secret: env("FACEBOOK_APP_SECRET"),
          redirect_uri: redirectUri,
          code,
        })}`,
      ),
      "Facebook sign-in",
    );
    const me = await json(
      await fetch(`${FACEBOOK_API}/me?${new URLSearchParams({ fields: "id,name,email", access_token: String(token.access_token) })}`),
      "Reading your Facebook profile",
    );
    // Facebook only shares confirmed email addresses; accounts made with a phone number have none.
    const email = typeof me.email === "string" ? me.email.toLowerCase() : null;
    return { provider, id: String(me.id), email, emailVerified: !!email, name: String(me.name ?? "") };
  }
  if (!devEnabled()) throw new OAuthError("Unknown sign-in provider.");
  const email = (devEmail || "dev.user@example.com").toLowerCase();
  return { provider, id: `dev:${email}`, email, emailVerified: true, name: email.split("@")[0] };
}
