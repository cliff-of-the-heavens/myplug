import { redirect } from "react-router";
import { trackClick } from "~/lib/banners.server";
import { isUuid } from "~/lib/utils";
import type { Route } from "./+types/ad";

/** Banner clicks come through here so they're counted, then go to the advertiser's link. */
export async function loader({ params }: Route.LoaderArgs) {
  const to = isUuid(params.id) ? await trackClick(params.id) : null;
  return redirect(to ?? "/", { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
