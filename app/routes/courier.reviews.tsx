import { Link } from "react-router";
import { OwnerReviews } from "~/components/owner-reviews";
import { Container, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { requireCourier } from "~/lib/auth.server";
import { flagReview, ratingSummary, ReviewError, reviewsFor } from "~/lib/reviews.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/courier.reviews";

export const meta: Route.MetaFunction = () => [{ title: "My ratings · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCourier(request);
  const [reviews, summary] = await Promise.all([reviewsFor({ courierId: user.courierId }), ratingSummary("courier", user.courierId)]);
  return { reviews, summary };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCourier(request);
  const form = await request.formData();
  try {
    await flagReview(str(form.get("reviewId")), user.id, String(form.get("reason") ?? ""));
    return { ok: "Sent to an admin. You'll be told what they decide." };
  } catch (e) {
    if (e instanceof ReviewError) return { error: e.message };
    throw e;
  }
}

export default function CourierReviews({ loaderData }: Route.ComponentProps) {
  return (
    <Container className="max-w-3xl py-8">
      <PageHeader
        title="My ratings"
        description="How customers rated your deliveries. Ask an admin to check a review that's abusive or untrue."
        actions={
          <Button asChild variant="outline">
            <Link to="/courier">Back to jobs</Link>
          </Button>
        }
      />
      <OwnerReviews reviews={loaderData.reviews} summary={loaderData.summary} canReply={false} />
    </Container>
  );
}
