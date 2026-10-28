import { and, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { SessionUser } from "./auth.server";
import { VOTE_MIN_ACCOUNT_DAYS, VOTES_PER_DAY, type VoteSummary } from "./handyman";
import { notify, notifyAdmins } from "./notify.server";
import { cleanText, type ReviewDecision } from "./reviews.server";

const { storeVotes, stores, users } = schema;

export class VoteError extends Error {}

const MAX_COMMENT = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Votes that count: not taken down by an admin, from people who aren't suspended. */
const counted = and(ne(storeVotes.status, "hidden"), eq(users.status, "active"));

/**
 * Up or down vote on a tradesperson, with an optional comment. One vote per person per
 * tradesperson: voting again changes it. Owners can't vote on themselves, and new accounts
 * have to wait a few days so throwaway accounts can't pile on.
 */
export async function castVote(user: SessionUser, storeId: string, value: number, comment: string) {
  if (value !== 1 && value !== -1) throw new VoteError("Vote up or down.");
  const store = await db.query.stores.findFirst({ where: eq(stores.id, storeId), columns: { id: true, ownerId: true, name: true, slug: true, isTradesperson: true, status: true } });
  if (!store || !store.isTradesperson || store.status !== "approved") throw new VoteError("You can only vote on handymen.");
  if (store.ownerId === user.id) throw new VoteError("You can't vote on your own profile.");

  const account = await db.query.users.findFirst({ where: eq(users.id, user.id), columns: { createdAt: true } });
  if (!account || Date.now() - account.createdAt.getTime() < VOTE_MIN_ACCOUNT_DAYS * DAY_MS) {
    throw new VoteError(`New accounts can vote after ${VOTE_MIN_ACCOUNT_DAYS} days.`);
  }
  const [{ n }] = await db
    .select({ n: count() })
    .from(storeVotes)
    .where(and(eq(storeVotes.userId, user.id), gte(storeVotes.updatedAt, new Date(Date.now() - DAY_MS))));
  if (n >= VOTES_PER_DAY) throw new VoteError("You've voted a lot today. Try again tomorrow.");

  const text = comment.trim().slice(0, MAX_COMMENT);
  const clean = text ? await cleanText(text) : null;
  const existing = await db.query.storeVotes.findFirst({ where: and(eq(storeVotes.storeId, storeId), eq(storeVotes.userId, user.id)) });
  if (existing) {
    // A comment an admin took down stays down; the vote itself can still change.
    await db
      .update(storeVotes)
      .set({ value, comment: clean, ...(existing.status === "hidden" ? {} : { status: "visible" as const }), updatedAt: new Date() })
      .where(eq(storeVotes.id, existing.id));
  } else {
    await db.insert(storeVotes).values({ storeId, userId: user.id, value, comment: clean });
    if (clean) await notify([store.ownerId], { title: value > 0 ? "Someone recommended you" : "Someone left you a comment", body: clean.slice(0, 140), href: "/sell/reviews" });
  }
}

export async function removeVote(userId: string, storeId: string) {
  await db.delete(storeVotes).where(and(eq(storeVotes.storeId, storeId), eq(storeVotes.userId, userId)));
}

/** Up and down counts for many tradespeople at once. */
export async function voteSummaries(storeIds: string[]) {
  const out = new Map<string, VoteSummary>(storeIds.map((id) => [id, { up: 0, down: 0 }]));
  if (!storeIds.length) return out;
  const rows = await db
    .select({ storeId: storeVotes.storeId, value: storeVotes.value, n: count() })
    .from(storeVotes)
    .innerJoin(users, eq(users.id, storeVotes.userId))
    .where(and(inArray(storeVotes.storeId, storeIds), counted))
    .groupBy(storeVotes.storeId, storeVotes.value);
  for (const r of rows) {
    const v = out.get(r.storeId)!;
    if (r.value > 0) v.up += r.n;
    else v.down += r.n;
  }
  return out;
}

/** The signed-in person's own vote on a tradesperson, if any. */
export async function myVote(userId: string | undefined, storeId: string) {
  if (!userId) return null;
  const v = await db.query.storeVotes.findFirst({
    where: and(eq(storeVotes.storeId, storeId), eq(storeVotes.userId, userId)),
    columns: { value: true, comment: true, status: true },
  });
  return v ?? null;
}

/** Public comments on a tradesperson's profile, newest first. */
export async function listVoteComments(storeId: string, limit = 30) {
  return db
    .select({
      id: storeVotes.id,
      value: storeVotes.value,
      comment: storeVotes.comment,
      reply: storeVotes.reply,
      createdAt: storeVotes.createdAt,
      // First name only, as with reviews.
      voter: sql<string>`split_part(${users.name}, ' ', 1)`,
    })
    .from(storeVotes)
    .innerJoin(users, eq(users.id, storeVotes.userId))
    .where(and(eq(storeVotes.storeId, storeId), counted, sql`${storeVotes.comment} is not null`))
    .orderBy(desc(storeVotes.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------- the tradesperson and admins

/** Everything the community said about a tradesperson, for their dashboard. */
export async function votesForOwner(storeId: string, limit = 100) {
  return db.query.storeVotes.findMany({
    where: eq(storeVotes.storeId, storeId),
    orderBy: desc(storeVotes.createdAt),
    limit,
    with: { user: { columns: { name: true } } },
  });
}

async function voteForOwner(voteId: string, storeId: string) {
  const v = await db.query.storeVotes.findFirst({ where: and(eq(storeVotes.id, voteId), eq(storeVotes.storeId, storeId)) });
  if (!v) throw new VoteError("Comment not found.");
  return v;
}

/** The tradesperson asks an admin to check a comment (it stays up until an admin decides). */
export async function flagVote(voteId: string, storeId: string, reason: string) {
  const why = reason.trim();
  if (why.length < 5) throw new VoteError("Tell the admin briefly what's wrong with this comment.");
  const v = await voteForOwner(voteId, storeId);
  if (v.status === "hidden") throw new VoteError("This comment has already been taken down.");
  await db.update(storeVotes).set({ status: "flagged", flagReason: why.slice(0, 500), flaggedAt: new Date(), updatedAt: new Date() }).where(eq(storeVotes.id, v.id));
  await notifyAdmins({ title: "Handyman comment flagged for checking", body: why.slice(0, 140), href: "/admin/reviews?tab=votes" });
}

export async function replyToVote(voteId: string, storeId: string, text: string) {
  const v = await voteForOwner(voteId, storeId);
  const reply = text.trim().slice(0, MAX_COMMENT);
  await db.update(storeVotes).set({ reply: reply ? await cleanText(reply) : null, updatedAt: new Date() }).where(eq(storeVotes.id, v.id));
}

/** Admin decision. A hidden vote no longer counts towards the score either. */
export async function moderateVote(voteId: string, decision: ReviewDecision, note: string) {
  const v = await db.query.storeVotes.findFirst({ where: eq(storeVotes.id, voteId), with: { store: { columns: { ownerId: true } } } });
  if (!v) throw new VoteError("Comment not found.");
  await db
    .update(storeVotes)
    .set({ status: decision === "hide" ? "hidden" : "visible", adminNote: note.trim() || null, reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(storeVotes.id, v.id));
  const outcome = decision === "hide" ? "was taken down" : decision === "restore" ? "was put back up" : "was checked and stays up";
  if (v.flaggedAt) await notify([v.store.ownerId], { title: `A comment you flagged ${outcome}`, body: note.trim() || undefined, href: "/sell/reviews" });
  if (decision === "hide") await notify([v.userId], { title: "Your comment was removed", body: note.trim() || "It didn't meet the community guidelines." });
}

export async function adminVotes(filter: "flagged" | "hidden" | "all", limit = 100) {
  return db.query.storeVotes.findMany({
    where: filter === "all" ? sql`${storeVotes.comment} is not null` : eq(storeVotes.status, filter),
    orderBy: [sql`case when ${storeVotes.status} = 'flagged' then 0 else 1 end`, desc(storeVotes.flaggedAt), desc(storeVotes.createdAt)],
    limit,
    with: { store: { columns: { name: true, slug: true } }, user: { columns: { id: true, name: true, email: true } } },
  });
}

export async function flaggedVoteCount() {
  const [{ n }] = await db.select({ n: count() }).from(storeVotes).where(eq(storeVotes.status, "flagged"));
  return n;
}
