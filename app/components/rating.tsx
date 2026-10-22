import { StarIcon } from "lucide-react";
import { useState } from "react";
import { timeAgo } from "~/lib/format";
import { findObscene } from "~/lib/profanity";
import { cn } from "~/lib/utils";

/** Read-only stars, filled to the nearest half. */
export function Stars({ value, className, size = "size-4" }: { value: number; className?: string; size?: string }) {
  return (
    <span className={cn("inline-flex items-center", className)} aria-label={`${value.toFixed(1)} out of 5 stars`} role="img">
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i + 1));
        const pct = fill >= 0.75 ? 100 : fill >= 0.25 ? 50 : 0;
        return (
          <span key={i} className={cn("relative inline-block", size)}>
            <StarIcon className={cn("absolute inset-0 text-muted-foreground/40", size)} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
              <StarIcon className={cn("fill-amber-400 text-amber-400", size)} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Compact "★ 4.6 (23)" for cards and headers. */
export function RatingBadge({ average, total, className }: { average: number | null | undefined; total: number; className?: string }) {
  if (!total || !average) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <StarIcon className="size-3.5 fill-amber-400 text-amber-400" />
      <span className="font-semibold text-foreground">{average.toFixed(1)}</span>({total})
    </span>
  );
}

/** Clickable 1-5 star picker that submits as a `rating` field. */
export function StarInput({ defaultValue = 0, name = "rating" }: { defaultValue?: number; name?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  const words = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
  return (
    <div className="flex items-center gap-2">
      <input type="hidden" name={name} value={value || ""} />
      <div className="flex" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={`${i} star${i > 1 ? "s" : ""}`}
            onClick={() => setValue(i)}
            onMouseEnter={() => setHover(i)}
            className="p-0.5"
          >
            <StarIcon className={cn("size-7 transition-colors", i <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
          </button>
        ))}
      </div>
      <span className="text-sm text-muted-foreground">{words[shown]}</span>
    </div>
  );
}

/** Comment box that warns, as you type, that obscene words will be masked. */
export function CommentBox({ defaultValue = "", name = "comment", placeholder }: { defaultValue?: string; name?: string; placeholder?: string }) {
  const [text, setText] = useState(defaultValue);
  const bad = findObscene(text);
  return (
    <div className="grid gap-1">
      <textarea
        name={name}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className={cn(bad.length && "font-medium text-destructive")}>
          {bad.length ? "Please keep it clean: rude words will be hidden with ***." : "Be honest and helpful. No personal details."}
        </span>
        <span>{text.length}/1000</span>
      </div>
    </div>
  );
}

export type Summary = { average: number; total: number; breakdown: { stars: number; n: number }[] };

export function RatingSummary({ summary }: { summary: Summary }) {
  if (!summary.total) return <p className="text-sm text-muted-foreground">No ratings yet.</p>;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="text-center">
        <p className="text-4xl font-extrabold">{summary.average.toFixed(1)}</p>
        <Stars value={summary.average} />
        <p className="text-xs text-muted-foreground">{summary.total} rating{summary.total === 1 ? "" : "s"}</p>
      </div>
      <div className="grid min-w-48 flex-1 gap-1">
        {summary.breakdown.map((b) => (
          <div key={b.stars} className="flex items-center gap-2 text-xs">
            <span className="w-3 text-right">{b.stars}</span>
            <StarIcon className="size-3 fill-amber-400 text-amber-400" />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-amber-400" style={{ width: `${(b.n / summary.total) * 100}%` }} />
            </div>
            <span className="w-6 text-muted-foreground">{b.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type PublicReview = { id: string; rating: number; comment: string | null; reply: string | null; createdAt: Date | string; reviewer: string };

export function ReviewList({ reviews, replyLabel = "Seller's reply" }: { reviews: PublicReview[]; replyLabel?: string }) {
  if (!reviews.length) return null;
  return (
    <ul className="divide-y">
      {reviews.map((r) => (
        <li key={r.id} className="grid gap-1 py-3">
          <div className="flex items-center gap-2">
            <Stars value={r.rating} size="size-3.5" />
            <span className="text-sm font-semibold">{r.reviewer}</span>
            <span className="text-xs text-muted-foreground">· verified order · {timeAgo(r.createdAt)}</span>
          </div>
          {r.comment ? <p className="text-sm whitespace-pre-line">{r.comment}</p> : null}
          {r.reply ? (
            <p className="ml-3 border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{replyLabel}: </span>
              {r.reply}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
