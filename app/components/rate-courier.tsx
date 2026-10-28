import { Form } from "react-router";
import { FormError } from "./page";
import { CommentBox, StarInput, Stars } from "./rating";
import { Button } from "./ui/button";

type Existing = { rating: number; comment: string | null; status: "visible" | "flagged" | "hidden"; updatedAt: Date | string } | null;

/**
 * Star rating and comment for the courier who did a transport job or car hire. Posts
 * intent=rate plus the hidden fields given (e.g. the booking id).
 */
export function RateCourier({
  courierName,
  review,
  fields = {},
  result,
  open,
}: {
  courierName: string;
  review: Existing;
  fields?: Record<string, string>;
  result?: { ok?: string; error?: string } | null;
  open?: boolean;
}) {
  return (
    <details open={open ?? (!review || !!result?.error)} className="rounded-xl border border-amber-300/60 p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm">
        <span className="flex-1 font-semibold">{review ? `Your rating of ${courierName}` : `Rate ${courierName}`}</span>
        {review ? (
          <>
            <Stars value={review.rating} size="size-3.5" />
            {review.status === "hidden" ? <span className="text-xs text-destructive">removed by admin</span> : <span className="text-xs text-muted-foreground">edit</span>}
          </>
        ) : null}
      </summary>
      <Form method="post" className="mt-3 grid gap-3" key={String(review?.updatedAt ?? "new")}>
        <input type="hidden" name="intent" value="rate" />
        {Object.entries(fields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {result?.error ? <FormError error={result.error} /> : null}
        {result?.ok ? <p className="text-sm font-semibold text-success">{result.ok}</p> : null}
        <StarInput defaultValue={review?.rating ?? 0} />
        <CommentBox defaultValue={review?.comment ?? ""} placeholder="Were they on time and careful? Was the vehicle clean and as described?" />
        <p className="text-xs text-muted-foreground">Your first name and rating are shown publicly. Rude words are hidden automatically.</p>
        <Button type="submit" size="sm" className="justify-self-start">
          {review ? "Update rating" : "Submit rating"}
        </Button>
      </Form>
    </details>
  );
}
