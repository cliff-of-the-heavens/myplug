import { requireCourier, requireMerchant, requireUser } from "~/lib/auth.server";
import { uploadImage, UploadError } from "~/lib/upload.server";
import type { Route } from "./+types/api.upload";

/**
 * Uploads one gallery/portfolio image and returns its URL. Galleries upload
 * photo by photo so no single request goes over Vercel's 4.5 MB body limit.
 */
export async function action({ request }: Route.ActionArgs) {
  // Merchants' galleries, and couriers' hire-car photos
  if ((await requireUser(request)).role === "courier") await requireCourier(request);
  else await requireMerchant(request);
  const form = await request.formData();
  try {
    const url = await uploadImage(form.get("file"), "gallery");
    if (!url) return Response.json({ error: "Choose an image." }, { status: 400 });
    return Response.json({ url });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
