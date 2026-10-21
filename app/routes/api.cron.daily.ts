import { processAlertQueue } from "~/lib/alerts.server";
import { runDuePlans } from "~/lib/recurring.server";
import { runRetention } from "~/lib/retention.server";
import type { Route } from "./+types/api.cron.daily";

/**
 * Daily jobs, run early each morning by Vercel Cron (vercel.json):
 * today's repeat-order deliveries, inactive-store archiving/deletion, and any
 * alert emails still waiting. Protected by `Authorization: Bearer $CRON_SECRET`.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const plans = await runDuePlans();
  const retention = await runRetention();
  const alerts = await processAlertQueue(100);
  return Response.json({ plans, retention, alerts });
}
