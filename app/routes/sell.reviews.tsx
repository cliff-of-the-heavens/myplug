import { OwnerVotes } from "~/components/handyman-votes";
import { OwnerReviews } from "~/components/owner-reviews";
import { PageHeader } from "~/components/page";
import { requireMerchant } from "~/lib/auth.server";
import { flagReview, ratingSummary, replyToReview, ReviewError, reviewsFor } from "~/lib/reviews.server";
import { str } from "~/lib/utils";
import { flagVote, replyToVote, VoteError, votesForOwner } from "~/lib/votes.server";
import type { Route } from "./+types/sell.reviews";

export const meta: Route.MetaFunction = () => [{ title: "Reviews · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const storeId = user.storeId!;
  const [reviews, summary, votes] = await Promise.all([
    reviewsFor({ storeId }),
    ratingSummary("store", storeId),
    user.isTradesperson ? votesForOwner(storeId) : null,
  ]);
  return { reviews, summary, votes };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireMerchant(request);
  const form = await request.formData();
  const reviewId = str(form.get("reviewId"));
  try {
    // Handymen: community votes and comments
    if (form.get("intent") === "vote-reply") {
      await replyToVote(str(form.get("voteId")), user.storeId, String(form.get("reply") ?? ""));
      return { ok: "Reply saved." };
    }
    if (form.get("intent") === "vote-flag") {
      await flagVote(str(form.get("voteId")), user.storeId, String(form.get("reason") ?? ""));
      return { ok: "Sent to an admin. You'll be told what they decide." };
    }
    if (form.get("intent") === "reply") {
      await replyToReview(reviewId, user.id, String(form.get("reply") ?? ""));
      return { ok: "Reply saved." };
    }
    await flagReview(reviewId, user.id, String(form.get("reason") ?? ""));
    return { ok: "Sent to an admin. You'll be told what they decide." };
  } catch (e) {
    if (e instanceof ReviewError || e instanceof VoteError) return { error: e.message };
    throw e;
  }
}

export default function SellReviews({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <PageHeader title="Reviews" description="What customers say about your store and products. Reply publicly, or ask an admin to check a review that's abusive or fake." />
      <OwnerReviews reviews={loaderData.reviews} summary={loaderData.summary} canReply />
      {loaderData.votes ? (
        <section className="mt-10 grid gap-3">
          <h2 className="text-xl font-extrabold">Community votes</h2>
          <p className="text-sm text-muted-foreground">Anyone signed in can vote you up or down on your profile, with a comment. Reply publicly, or ask an admin to check a comment that's abusive or fake.</p>
          <OwnerVotes votes={loaderData.votes} />
        </section>
      ) : null}
    </div>
  );
}
