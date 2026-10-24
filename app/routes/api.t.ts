import type { TrackBatch } from "~/lib/analytics";
import { recordBatch } from "~/lib/analytics.server";
import { sessionUserId } from "~/lib/auth.server";
import type { Route } from "./+types/api.t";

/**
 * Receives analytics batches from the browser (navigator.sendBeacon). Always answers 204:
 * bad or oversized input is ignored, and a failure never surfaces to the visitor.
 */
export async function action({ request }: Route.ActionArgs) {
  try {
    const text = await request.text();
    if (text.length > 16_000) return new Response(null, { status: 204 });
    const batch = JSON.parse(text) as TrackBatch;
    await recordBatch(batch, { userAgent: request.headers.get("User-Agent"), userId: await sessionUserId(request) });
  } catch (e) {
    if (!(e instanceof SyntaxError)) console.error("analytics", e);
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export function loader() {
  return new Response(null, { status: 405 });
}
