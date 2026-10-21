import { and, eq } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { setEmailAlerts, setSubscription, unsubscribeStore } from "~/lib/alerts.server";
import { requireCustomer } from "~/lib/auth.server";
import { isUuid, str } from "~/lib/utils";
import type { Route } from "./+types/api.subscribe";

/** Follow / unfollow a store's email alerts (customers only). */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const form = await request.formData();
  const storeId = str(form.get("storeId"));
  if (!isUuid(storeId)) return { error: "Store not found." };
  const store = await db.query.stores.findFirst({
    where: and(eq(schema.stores.id, storeId), eq(schema.stores.status, "approved")),
    columns: { id: true },
  });
  if (!store) return { error: "Store not found." };

  if (form.get("intent") === "unfollow") {
    await unsubscribeStore(user.id, store.id);
    return { ok: true };
  }
  const prefs = {
    newProducts: form.get("newProducts") === "on",
    restocks: form.get("restocks") === "on",
    discounts: form.get("discounts") === "on",
  };
  await setSubscription(user.id, store.id, prefs);
  // Choosing alerts here is an explicit opt-in, so it switches the account-wide setting back on.
  if (prefs.newProducts || prefs.restocks || prefs.discounts) await setEmailAlerts(user.id, true);
  return { ok: true };
}
