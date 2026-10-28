import { and, arrayContains, eq } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { notify } from "./notify.server";

const { stores } = schema;

/**
 * A customer posted a job in a trade: tell every approved handyman working in it (in the app and
 * by email), so they can reply with a quote.
 */
export async function notifyTradespeople(job: { id: string; title: string; location: string; tradeSlug: string; tradeName: string }) {
  const owners = await db
    .select({ id: stores.ownerId })
    .from(stores)
    .where(and(eq(stores.isTradesperson, true), eq(stores.status, "approved"), arrayContains(stores.trades, [job.tradeSlug])));
  await notify(
    owners.map((o) => o.id),
    { title: `New ${job.tradeName.toLowerCase()} job: ${job.title.slice(0, 80)}`, body: job.location, href: `/requests/${job.id}` },
    { email: true },
  );
}
