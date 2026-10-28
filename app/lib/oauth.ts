/** Sign-in providers. "dev" is a local stand-in for trying the flow without real app keys. */
export type ProviderId = "google" | "facebook" | "dev";

export const PROVIDER_NAME: Record<ProviderId, string> = { google: "Google", facebook: "Facebook", dev: "Dev (test)" };

/** What a new social sign-up still needs to finish on the register page. */
export type PendingSocial = { provider: ProviderId; id: string; email: string | null; emailVerified: boolean; name: string };
