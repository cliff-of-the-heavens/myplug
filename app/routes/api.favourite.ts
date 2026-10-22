import { requireUser } from "~/lib/auth.server";
import { toggleFavourite } from "~/lib/shopping.server";
import { isUuid, str } from "~/lib/utils";
import type { Route } from "./+types/api.favourite";

/** Saves or un-saves a product or store (any signed-in user). */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const productId = str(form.get("productId"));
  const storeId = str(form.get("storeId"));
  if (!isUuid(productId) && !isUuid(storeId)) return { error: "Nothing to save." };
  const saved = await toggleFavourite(user.id, isUuid(productId) ? { productId } : { storeId });
  return { saved };
}
