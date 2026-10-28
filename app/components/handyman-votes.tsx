import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { useState } from "react";
import { useFetcher } from "react-router";
import { voteLabel, type VoteSummary } from "~/lib/handyman";
import { timeAgo } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { action as voteAction } from "~/routes/api.vote";
import { AuthLink } from "./auth-dialog";
import { FormError } from "./page";
import { CommentBox } from "./rating";
import { Button } from "./ui/button";

/** Compact community score for cards, e.g. "👍 +12 (15)". */
export function VoteBadge({ summary, className }: { summary: VoteSummary; className?: string }) {
  const total = summary.up + summary.down;
  if (!total) return null;
  const net = summary.up - summary.down;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}
      title={`${summary.up} up, ${summary.down} down`}
    >
      {net >= 0 ? <ThumbsUpIcon className="size-3.5 text-success" /> : <ThumbsDownIcon className="size-3.5 text-destructive" />}
      <span className="font-semibold text-foreground">{voteLabel(summary)}</span>({total})
    </span>
  );
}

type MyVote = { value: number; comment: string | null } | null;

/**
 * Vote a handyman up or down, with an optional comment about their work. Anyone signed in can
 * vote once (voting again changes it); guests are offered the sign-in pop-up.
 */
export function HandymanVotes({
  storeId,
  summary,
  mine,
  signedIn,
  isOwner,
}: {
  storeId: string;
  summary: VoteSummary;
  mine: MyVote;
  signedIn: boolean;
  isOwner: boolean;
}) {
  const fetcher = useFetcher<typeof voteAction>();
  const [choice, setChoice] = useState<number>(mine?.value ?? 0);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;

  const counts = (
    <div className="flex items-center gap-4 text-sm">
      <span className="flex items-center gap-1.5">
        <ThumbsUpIcon className="size-5 text-success" /> <strong>{summary.up}</strong> up
      </span>
      <span className="flex items-center gap-1.5">
        <ThumbsDownIcon className="size-5 text-destructive" /> <strong>{summary.down}</strong> down
      </span>
    </div>
  );

  if (isOwner) return counts;
  if (!signedIn) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {counts}
        <Button asChild variant="outline" size="sm">
          <AuthLink mode="login">Sign in to vote</AuthLink>
        </Button>
      </div>
    );
  }

  return (
    <fetcher.Form method="post" action="/api/vote" className="grid gap-3">
      <input type="hidden" name="storeId" value={storeId} />
      <div className="flex flex-wrap items-center gap-3">
        {counts}
        <div className="ml-auto flex gap-2" role="radiogroup" aria-label="Your vote">
          {[
            { value: 1, label: "Recommend", Icon: ThumbsUpIcon, on: "border-success bg-success/15 text-success" },
            { value: -1, label: "Not recommended", Icon: ThumbsDownIcon, on: "border-destructive bg-destructive/10 text-destructive" },
          ].map((o) => (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-semibold transition-colors",
                choice === o.value ? o.on : "hover:border-primary/40",
              )}
            >
              <input type="radio" name="value" value={o.value} checked={choice === o.value} onChange={() => setChoice(o.value)} className="sr-only" />
              <o.Icon className="size-4" /> {o.label}
            </label>
          ))}
        </div>
      </div>
      {choice ? (
        <>
          <CommentBox
            defaultValue={mine?.comment ?? ""}
            placeholder="What did they do for you? How was the work? (optional)"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving..." : mine ? "Update my vote" : "Submit vote"}
            </Button>
            {mine ? (
              <Button type="submit" name="intent" value="remove" variant="ghost" disabled={busy} onClick={() => setChoice(0)}>
                Remove my vote
              </Button>
            ) : null}
            {result && "ok" in result ? <span className="text-sm font-medium text-success">{result.ok}</span> : null}
          </div>
        </>
      ) : null}
      <FormError error={result && "error" in result ? result.error : null} />
    </fetcher.Form>
  );
}

type Comment = { id: string; value: number; comment: string | null; reply: string | null; createdAt: Date | string; voter: string };

export function VoteComments({ comments, ownerName }: { comments: Comment[]; ownerName: string }) {
  if (!comments.length) return <p className="text-sm text-muted-foreground">No comments yet. Hired them? Say how it went.</p>;
  return (
    <ul className="grid gap-4">
      {comments.map((c) => (
        <li key={c.id} className="grid gap-1 border-b pb-4 last:border-0 last:pb-0">
          <p className="flex items-center gap-2 text-sm">
            {c.value > 0 ? <ThumbsUpIcon className="size-4 text-success" /> : <ThumbsDownIcon className="size-4 text-destructive" />}
            <span className="font-semibold">{c.voter}</span>
            <span className="text-xs text-muted-foreground">{timeAgo(c.createdAt)}</span>
          </p>
          <p className="text-sm whitespace-pre-line">{c.comment}</p>
          {c.reply ? (
            <p className="ml-4 rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="font-semibold">{ownerName} replied:</span> {c.reply}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export type OwnerVote = {
  id: string;
  value: number;
  comment: string | null;
  reply: string | null;
  status: "visible" | "flagged" | "hidden";
  flagReason: string | null;
  adminNote: string | null;
  createdAt: Date | string;
  user: { name: string };
};

/** A handyman's community votes, with a public reply and "ask an admin to check" on comments. */
export function OwnerVotes({ votes }: { votes: OwnerVote[] }) {
  const counted = votes.filter((v) => v.status !== "hidden");
  const summary = { up: counted.filter((v) => v.value > 0).length, down: counted.filter((v) => v.value < 0).length };
  return (
    <div className="grid gap-4">
      <p className="flex flex-wrap items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <ThumbsUpIcon className="size-5 text-success" /> <strong>{summary.up}</strong> recommend you
        </span>
        <span className="flex items-center gap-1.5">
          <ThumbsDownIcon className="size-5 text-destructive" /> <strong>{summary.down}</strong> don't
        </span>
      </p>
      {votes.length ? (
        votes.map((v) => <OwnerVoteCard key={v.id} vote={v} />)
      ) : (
        <p className="text-sm text-muted-foreground">No votes yet. Ask happy customers to vote for you on your profile.</p>
      )}
    </div>
  );
}

function OwnerVoteCard({ vote: v }: { vote: OwnerVote }) {
  const fetcher = useFetcher<{ error?: string; ok?: string }>();
  const busy = fetcher.state !== "idle";
  return (
    <div className={cn("grid gap-2 rounded-2xl border bg-card p-4", v.status === "hidden" && "opacity-60")}>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        {v.value > 0 ? <ThumbsUpIcon className="size-4 text-success" /> : <ThumbsDownIcon className="size-4 text-destructive" />}
        <span className="font-semibold">{v.user.name.split(" ")[0]}</span>
        <span className="text-xs text-muted-foreground">{timeAgo(v.createdAt)}</span>
        {v.status === "flagged" ? <span className="rounded-full bg-highlight/30 px-2 text-xs font-semibold">Waiting for admin</span> : null}
        {v.status === "hidden" ? <span className="rounded-full bg-muted px-2 text-xs font-semibold">Taken down</span> : null}
      </p>
      {v.comment ? <p className="text-sm whitespace-pre-line">{v.comment}</p> : <p className="text-sm text-muted-foreground italic">Vote only, no comment.</p>}
      {v.status === "flagged" && v.flagReason ? <p className="text-xs text-muted-foreground">You asked: {v.flagReason}</p> : null}
      {v.adminNote ? <p className="text-xs text-muted-foreground">Admin: {v.adminNote}</p> : null}
      <FormError error={fetcher.data?.error} />
      {fetcher.data?.ok ? <p className="text-sm font-medium text-success">{fetcher.data.ok}</p> : null}
      {v.comment && v.status !== "hidden" ? (
        <details>
          <summary className="w-fit cursor-pointer text-sm font-semibold text-primary">{v.reply ? "Edit public reply" : "Reply publicly"}</summary>
          <fetcher.Form method="post" className="mt-2 grid gap-2">
            <input type="hidden" name="voteId" value={v.id} />
            <textarea name="reply" defaultValue={v.reply ?? ""} maxLength={1000} rows={2} className="rounded-xl border bg-transparent px-3 py-2 text-sm" />
            <Button type="submit" name="intent" value="vote-reply" size="sm" disabled={busy} className="justify-self-start">
              Save reply
            </Button>
          </fetcher.Form>
        </details>
      ) : null}
      {v.comment && v.status === "visible" ? (
        <details>
          <summary className="w-fit cursor-pointer text-sm font-semibold text-muted-foreground">Ask an admin to check this comment</summary>
          <fetcher.Form method="post" className="mt-2 grid gap-2">
            <input type="hidden" name="voteId" value={v.id} />
            <textarea name="reason" required minLength={5} maxLength={500} rows={2} placeholder="e.g. Never hired me; a competitor; abusive language." className="rounded-xl border bg-transparent px-3 py-2 text-sm" />
            <Button type="submit" name="intent" value="vote-flag" size="sm" variant="outline" disabled={busy} className="justify-self-start">
              Send to admin
            </Button>
          </fetcher.Form>
        </details>
      ) : null}
    </div>
  );
}
