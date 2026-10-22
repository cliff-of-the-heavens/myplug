import { redirect } from "react-router";
import { requireCustomer } from "~/lib/auth.server";
import { addToCart, CartError, removeFromCart, setCartQuantity } from "~/lib/shopping.server";
import { isUuid, str } from "~/lib/utils";
import type { Route } from "./+types/api.cart";

/** Cart changes: add (optionally "buy now", which goes straight to that store's checkout), set quantity, remove. */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const form = await request.formData();
  const productId = str(form.get("productId"));
  if (!isUuid(productId)) return { error: "Choose a product." };
  const intent = form.get("intent");
  try {
    if (intent === "add" || intent === "buy") {
      await addToCart(user.id, productId, Math.floor(Number(form.get("quantity") ?? 1)) || 1);
      if (intent === "buy") return redirect(`/cart/checkout/${str(form.get("storeId"))}`);
      return { ok: "Added to your cart." };
    }
    if (intent === "set") {
      await setCartQuantity(user.id, productId, Math.floor(Number(form.get("quantity"))));
      return { ok: "Updated." };
    }
    if (intent === "remove") {
      await removeFromCart(user.id, [productId]);
      return { ok: "Removed." };
    }
  } catch (e) {
    if (e instanceof CartError) return { error: e.message };
    throw e;
  }
  return { error: "Unknown action." };
}
