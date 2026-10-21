import { processAlertQueue } from "~/lib/alerts.server";
import type { Route } from "./+types/api.cron.alerts";

/**
 * Sends alert emails that weren't finished when the merchant sent the alert
 * (large subscriber lists, provider errors). Called by Vercel Cron (vercel.json),
 * which sends `Authorization: Bearer $CRON_SECRET`.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const totals = { sent: 0, skipped: 0, failed: 0 };
  const deadline = Date.now() + 45_000; // stay well inside the function time limit
  while (Date.now() < deadline) {
    const r = await processAlertQueue(100);
    totals.sent += r.sent;
    totals.skipped += r.skipped;
    totals.failed += r.failed;
    if (r.sent + r.skipped + r.failed === 0) break;
  }
  return Response.json(totals);
}
