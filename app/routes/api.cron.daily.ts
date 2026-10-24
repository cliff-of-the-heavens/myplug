import { processAlertQueue } from "~/lib/alerts.server";
import { rollupAnalytics } from "~/lib/analytics.server";
import { runListingCleanup } from "~/lib/property.server";
import { runDuePlans } from "~/lib/recurring.server";
import { runRetention } from "~/lib/retention.server";
import type { Route } from "./+types/api.cron.daily";

/**
 * Daily jobs, run early each morning by Vercel Cron (vercel.json):
 * today's repeat-order deliveries, inactive-store archiving/deletion, sold/sold-out listing
 * archiving and deletion (and "bidding closed" notices), and any alert emails still waiting.
 * On Vercel's Hobby plan this is the only scheduled job (Hobby allows one run a day), so it
 * also clears the whole alert queue rather than one batch. Alerts send their first 100 emails
 * the moment a merchant sends them; only larger lists wait for this job.
 * Protected by `Authorization: Bearer $CRON_SECRET`.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const plans = await runDuePlans();
  const retention = await runRetention();
  const listings = await runListingCleanup();
  const analytics = await rollupAnalytics();

  const alerts = { sent: 0, skipped: 0, failed: 0 };
  const deadline = Date.now() + 40_000; // stay inside the function time limit; the rest goes tomorrow
  while (Date.now() < deadline) {
    const r = await processAlertQueue(100);
    alerts.sent += r.sent;
    alerts.skipped += r.skipped;
    alerts.failed += r.failed;
    if (r.sent + r.skipped + r.failed === 0) break;
  }
  return Response.json({ plans, retention, listings, analytics, alerts });
}
