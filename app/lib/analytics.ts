/** Analytics events the browser batches and sends to /api/t (shared by the client and server). */
export type TrackEvent =
  | { t: "page" } // a page view
  | { t: "store"; id: string } // a store page, or a product of that store, was viewed
  | { t: "product"; id: string }
  | { t: "ad"; id: string; ms: number }; // a banner ad was on screen (at least half visible) for ms

export type TrackBatch = {
  v: string; // anonymous visitor id (random, kept in the browser)
  newDay?: boolean; // first batch from this visitor today (counts a unique visitor)
  e: TrackEvent[];
};

export const MAX_EVENTS = 60;
export const MAX_AD_MS = 5 * 60_000; // ignore longer per batch: a tab left open isn't attention
