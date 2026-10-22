import { OwnerReviews } from "~/components/owner-reviews";
import { PageHeader } from "~/components/page";
import { requireMerchant } from "~/lib/auth.server";
import { flagReview, ratingSummary, replyToReview, ReviewError, reviewsFor } from "~/lib/reviews.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/sell.reviews";

export const meta: Route.MetaFunction = () => [{ title: "Reviews · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const storeId = user.storeId!;
  const [reviews, summary] = await Promise.all([reviewsFor({ storeId }), ratingSummary("store", storeId)]);
  return { reviews, summary };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireMerchant(request);
  const form = await request.formData();
  const reviewId = str(form.get("reviewId"));
  try {
    if (form.get("intent") === "reply") {
      await replyToReview(reviewId, user.id, String(form.get("reply") ?? ""));
      return { ok: "Reply saved." };
    }
    await flagReview(reviewId, user.id, String(form.get("reason") ?? ""));
    return { ok: "Sent to an admin. You'll be told what they decide." };
  } catch (e) {
    if (e instanceof ReviewError) return { error: e.message };
    throw e;
  }
}

export default function SellReviews({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <PageHeader title="Reviews" description="What customers say about your store and products. Reply publicly, or ask an admin to check a review that's abusive or fake." />
      <OwnerReviews reviews={loaderData.reviews} summary={loaderData.summary} canReply />
    </div>
  );
}
