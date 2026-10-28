import { FlagIcon, MessageSquareReplyIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { timeAgo } from "~/lib/format";
import { FormError } from "./page";
import { RatingSummary, Stars, type Summary } from "./rating";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Textarea } from "./ui/input";

export type OwnerReview = {
  id: string;
  target: "product" | "store" | "courier";
  rating: number;
  comment: string | null;
  reply: string | null;
  status: "visible" | "flagged" | "hidden";
  flagReason: string | null;
  adminNote: string | null;
  createdAt: Date | string;
  product: { id: string; title: string } | null;
  customer: { name: string };
  transportJobId?: string | null;
  carBookingId?: string | null;
};

/** A merchant's or courier's reviews, with reply (merchants) and "ask an admin to check". */
export function OwnerReviews({ reviews, summary, canReply }: { reviews: OwnerReview[]; summary: Summary; canReply: boolean }) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="pt-5">
          <RatingSummary summary={summary} />
        </CardContent>
      </Card>
      {reviews.length ? (
        reviews.map((r) => <OwnerReviewCard key={r.id} review={r} canReply={canReply} />)
      ) : (
        <p className="text-sm text-muted-foreground">No reviews yet. Customers can rate once an order is delivered.</p>
      )}
    </div>
  );
}

function OwnerReviewCard({ review: r, canReply }: { review: OwnerReview; canReply: boolean }) {
  const fetcher = useFetcher<{ error?: string; ok?: string }>();
  const busy = fetcher.state !== "idle";
  return (
    <Card className={r.status === "hidden" ? "opacity-60" : undefined}>
      <CardContent className="grid gap-2 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <Stars value={r.rating} />
          <span className="text-sm font-semibold">{r.customer.name.split(" ")[0]}</span>
          <span className="text-xs text-muted-foreground">
            {r.target === "product" && r.product
              ? `on ${r.product.title}`
              : r.target === "store"
                ? "about your store"
                : r.transportJobId
                  ? "about a transport job"
                  : r.carBookingId
                    ? "about a car hire"
                    : "about your delivery"} · {timeAgo(r.createdAt)}
          </span>
          {r.status === "flagged" ? <Badge variant="highlight">Waiting for admin</Badge> : null}
          {r.status === "hidden" ? <Badge variant="muted">Taken down</Badge> : null}
        </div>
        {r.comment ? <p className="text-sm whitespace-pre-line">{r.comment}</p> : <p className="text-sm text-muted-foreground italic">No comment, rating only.</p>}
        {r.status === "flagged" && r.flagReason ? <p className="text-xs text-muted-foreground">You asked: {r.flagReason}</p> : null}
        {r.adminNote ? <p className="text-xs text-muted-foreground">Admin: {r.adminNote}</p> : null}
        <FormError error={fetcher.data?.error} />
        {fetcher.data?.ok ? <p className="text-sm font-medium text-success">{fetcher.data.ok}</p> : null}

        <div className="flex flex-wrap gap-2">
          {canReply && r.status !== "hidden" ? (
            <details className="w-full">
              <summary className="flex w-fit cursor-pointer items-center gap-1 text-sm font-semibold text-primary">
                <MessageSquareReplyIcon className="size-4" /> {r.reply ? "Edit public reply" : "Reply publicly"}
              </summary>
              <fetcher.Form method="post" className="mt-2 grid gap-2">
                <input type="hidden" name="reviewId" value={r.id} />
                <Textarea name="reply" defaultValue={r.reply ?? ""} maxLength={1000} rows={2} placeholder="Thank the customer or explain what you'll do about it." />
                <Button type="submit" name="intent" value="reply" size="sm" disabled={busy} className="justify-self-start">
                  Save reply
                </Button>
              </fetcher.Form>
            </details>
          ) : null}
          {r.status === "visible" ? (
            <details className="w-full">
              <summary className="flex w-fit cursor-pointer items-center gap-1 text-sm font-semibold text-muted-foreground">
                <FlagIcon className="size-4" /> Ask an admin to check this review
              </summary>
              <fetcher.Form method="post" className="mt-2 grid gap-2">
                <input type="hidden" name="reviewId" value={r.id} />
                <Textarea name="reason" required minLength={5} maxLength={500} rows={2} placeholder="e.g. Fake review, this customer never received the item; threatening language; competitor." />
                <p className="text-xs text-muted-foreground">The review stays visible until an admin decides. Honest criticism is allowed; abuse, lies and threats are not.</p>
                <Button type="submit" name="intent" value="flag" size="sm" variant="outline" disabled={busy} className="justify-self-start">
                  Send to admin
                </Button>
              </fetcher.Form>
            </details>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
