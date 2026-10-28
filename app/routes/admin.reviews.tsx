import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { FormError, PageHeader } from "~/components/page";
import { Stars } from "~/components/rating";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input, Textarea } from "~/components/ui/input";
import { requireAdmin } from "~/lib/auth.server";
import { timeAgo } from "~/lib/format";
import { adminReviews, getWordSettings, moderateReview, ReviewError, saveWordSettings, type ReviewDecision } from "~/lib/reviews.server";
import { cn, str } from "~/lib/utils";
import { adminVotes, flaggedVoteCount, moderateVote, VoteError } from "~/lib/votes.server";
import type { Route } from "./+types/admin.reviews";

export const meta: Route.MetaFunction = () => [{ title: "Reviews · Admin · MyPlug" }];

const FILTERS = [
  { value: "flagged", label: "Flagged" },
  { value: "all", label: "All" },
  { value: "hidden", label: "Taken down" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const f = url.searchParams.get("show");
  const filter: Filter = f === "all" || f === "hidden" ? f : "flagged";
  // Handyman community comments are moderated here too, on their own tab.
  const tab = url.searchParams.get("tab") === "votes" ? "votes" : "reviews";
  const [reviews, votes, flaggedVotes, words] = await Promise.all([
    tab === "reviews" ? adminReviews(filter) : [],
    tab === "votes" ? adminVotes(filter) : [],
    flaggedVoteCount(),
    getWordSettings(),
  ]);
  return { reviews, votes, flaggedVotes, words, filter, tab };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  if (form.get("intent") === "words") {
    await saveWordSettings(String(form.get("extra") ?? ""), String(form.get("allow") ?? ""));
    return { ok: "Word lists saved. New reviews and replies use them straight away." };
  }
  const decision = str(form.get("decision")) as ReviewDecision;
  if (!["hide", "restore", "keep"].includes(decision)) return { error: "Unknown action." };
  try {
    if (form.get("voteId")) {
      await moderateVote(str(form.get("voteId")), decision, String(form.get("note") ?? ""));
      return { ok: decision === "hide" ? "Comment taken down; its vote no longer counts. The voter and the handyman were told." : "Done." };
    }
    await moderateReview(str(form.get("reviewId")), decision, String(form.get("note") ?? ""));
    return { ok: decision === "hide" ? "Review taken down. The customer and the merchant were told." : "Done. Everyone involved was told." };
  } catch (e) {
    if (e instanceof ReviewError || e instanceof VoteError) return { error: e.message };
    throw e;
  }
}

export default function AdminReviews({ loaderData, actionData }: Route.ComponentProps) {
  const { reviews, votes, flaggedVotes, words, filter, tab } = loaderData;
  const [params] = useSearchParams();
  const busy = useNavigation().state !== "idle";
  return (
    <div className="grid gap-6">
      <PageHeader title="Reviews" description="Merchants and couriers can ask you to check a review. Take down abuse, threats, lies and spam; keep honest criticism." />
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      {actionData && "ok" in actionData ? <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}

      <div className="flex gap-2 border-b pb-3">
        {(
          [
            ["reviews", "Customer reviews"],
            ["votes", `Handyman comments${flaggedVotes ? ` (${flaggedVotes})` : ""}`],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            to={`?${new URLSearchParams({ show: filter, tab: value })}`}
            className={cn("rounded-full px-4 py-1.5 text-sm font-semibold", tab === value ? "bg-foreground text-background" : "bg-muted hover:bg-muted/70")}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            to={`?${new URLSearchParams({ ...Object.fromEntries(params), show: f.value })}`}
            className={cn("rounded-full px-4 py-1.5 text-sm font-semibold", filter === f.value ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70")}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {tab === "votes" ? (
        votes.length ? (
          <div className="grid gap-3">
            {votes.map((v) => (
              <Card key={v.id}>
                <CardContent className="grid gap-2 pt-5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {v.value > 0 ? <ThumbsUpIcon className="size-4 text-success" /> : <ThumbsDownIcon className="size-4 text-destructive" />}
                    <Link to={`/s/${v.store.slug}`} className="font-semibold hover:underline">{v.store.name}</Link>
                    <span className="text-xs text-muted-foreground">
                      by <Link to={`/admin/users/${v.user.id}`} className="hover:underline">{v.user.name}</Link> · {timeAgo(v.createdAt)}
                    </span>
                    {v.status === "flagged" ? <Badge variant="highlight">Flagged</Badge> : v.status === "hidden" ? <Badge variant="muted">Taken down</Badge> : null}
                  </div>
                  {v.comment ? <p className="text-sm whitespace-pre-line">{v.comment}</p> : <p className="text-sm text-muted-foreground italic">Vote only.</p>}
                  {v.reply ? <p className="border-l-2 pl-3 text-sm text-muted-foreground">Reply: {v.reply}</p> : null}
                  {v.flagReason ? (
                    <p className="rounded-lg bg-highlight/20 px-3 py-2 text-sm">
                      <strong>Why they flagged it:</strong> {v.flagReason}
                    </p>
                  ) : null}
                  {v.adminNote ? <p className="text-xs text-muted-foreground">Earlier admin note: {v.adminNote}</p> : null}
                  <Form method="post" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="voteId" value={v.id} />
                    <Input name="note" placeholder="Note to the people involved (optional)" className="min-w-56 flex-1" />
                    {v.status !== "hidden" ? (
                      <Button type="submit" name="decision" value="hide" variant="destructive" size="sm" disabled={busy}>
                        Take down
                      </Button>
                    ) : (
                      <Button type="submit" name="decision" value="restore" size="sm" disabled={busy}>
                        Put back up
                      </Button>
                    )}
                    {v.status === "flagged" ? (
                      <Button type="submit" name="decision" value="keep" variant="outline" size="sm" disabled={busy}>
                        Keep it up
                      </Button>
                    ) : null}
                  </Form>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{filter === "flagged" ? "Nothing waiting. Comments handymen flag appear here." : "No comments here."}</p>
        )
      ) : reviews.length ? (
        <div className="grid gap-3">
          {reviews.map((r) => (
            <Card key={r.id}>
              <CardContent className="grid gap-2 pt-5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Stars value={r.rating} size="size-3.5" />
                  <span className="font-semibold">
                    {r.target === "product" && r.product ? (
                      <Link to={`/p/${r.product.id}`} className="hover:underline">{r.product.title}</Link>
                    ) : r.target === "store" && r.store ? (
                      <Link to={`/s/${r.store.slug}`} className="hover:underline">{r.store.name}</Link>
                    ) : (
                      `Courier: ${r.courier?.name ?? "?"}`
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    by <Link to={`/admin/users/${r.customer.id}`} className="hover:underline">{r.customer.name}</Link> · {timeAgo(r.createdAt)}
                  </span>
                  {r.status === "flagged" ? <Badge variant="highlight">Flagged</Badge> : r.status === "hidden" ? <Badge variant="muted">Taken down</Badge> : null}
                </div>
                {r.comment ? <p className="text-sm whitespace-pre-line">{r.comment}</p> : <p className="text-sm text-muted-foreground italic">Rating only.</p>}
                {r.reply ? <p className="border-l-2 pl-3 text-sm text-muted-foreground">Reply: {r.reply}</p> : null}
                {r.flagReason ? (
                  <p className="rounded-lg bg-highlight/20 px-3 py-2 text-sm">
                    <strong>Why they flagged it:</strong> {r.flagReason}
                  </p>
                ) : null}
                {r.adminNote ? <p className="text-xs text-muted-foreground">Earlier admin note: {r.adminNote}</p> : null}
                <Form method="post" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="reviewId" value={r.id} />
                  <Input name="note" placeholder="Note to the people involved (optional)" className="min-w-56 flex-1" />
                  {r.status !== "hidden" ? (
                    <Button type="submit" name="decision" value="hide" variant="destructive" size="sm" disabled={busy}>
                      Take down
                    </Button>
                  ) : (
                    <Button type="submit" name="decision" value="restore" size="sm" disabled={busy}>
                      Put back up
                    </Button>
                  )}
                  {r.status === "flagged" ? (
                    <Button type="submit" name="decision" value="keep" variant="outline" size="sm" disabled={busy}>
                      Keep it up
                    </Button>
                  ) : null}
                </Form>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{filter === "flagged" ? "Nothing waiting. Flagged reviews appear here." : "No reviews here."}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Obscene-word filter</CardTitle>
          <p className="text-sm text-muted-foreground">
            Common English swear words and slurs are always masked (e.g. "s***"), including disguised spellings like "sh1t" or "f.u.c.k".
            Add local-language words here, and allow words that are wrongly caught.
          </p>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4">
            <input type="hidden" name="intent" value="words" />
            <Field label="Also block these words" hint="Separate with commas or new lines">
              <Textarea name="extra" defaultValue={words.extra} rows={3} placeholder="e.g. words in Chichewa, Tumbuka or other languages" />
            </Field>
            <Field label="Never block these words" hint="For words with an innocent meaning in your market">
              <Textarea name="allow" defaultValue={words.allow} rows={2} placeholder="e.g. damn" />
            </Field>
            <Button type="submit" disabled={busy} className="justify-self-start">
              Save word lists
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
