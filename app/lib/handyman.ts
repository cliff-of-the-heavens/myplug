/**
 * Handymen: tradespeople who repair things and do practical work at the customer's place. Their
 * trades are service categories in the "handyman" group, with their own main menu tab. A
 * handyman's store (isTradesperson) is their profile page, voted on by the community.
 */
export const HANDYMAN_GROUP = "handyman";

/** Signed-up accounts must be this old before they can vote, so throwaway accounts can't pile on. */
export const VOTE_MIN_ACCOUNT_DAYS = 3;
/** Most votes (new or changed) one person can cast in a day. */
export const VOTES_PER_DAY = 20;

export type VoteSummary = { up: number; down: number };

/** Net score shown on cards, e.g. "+12". */
export function voteLabel(v: VoteSummary) {
  const net = v.up - v.down;
  return net > 0 ? `+${net}` : String(net);
}
