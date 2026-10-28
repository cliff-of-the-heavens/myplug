import { requireUser } from "~/lib/auth.server";
import { castVote, removeVote, VoteError } from "~/lib/votes.server";
import { isUuid, str } from "~/lib/utils";
import type { Route } from "./+types/api.vote";

/** Votes a handyman up or down (with an optional comment), or takes the vote back. */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const storeId = str(form.get("storeId"));
  if (!isUuid(storeId)) return { error: "Nothing to vote on." };
  try {
    if (form.get("intent") === "remove") {
      await removeVote(user.id, storeId);
      return { ok: "Your vote was removed." };
    }
    await castVote(user, storeId, Number(form.get("value")), str(form.get("comment")));
    return { ok: "Thanks for your vote!" };
  } catch (e) {
    if (e instanceof VoteError) return { error: e.message };
    throw e;
  }
}
