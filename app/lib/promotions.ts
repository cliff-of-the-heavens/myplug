import type { PromotionStatus, PromotionTier } from "~/db/schema";

/** How much a paid tier multiplies a product's chance of appearing near the top. */
export const TIER_WEIGHT: Record<PromotionTier, number> = { boost: 3, featured: 6, premium: 10 };

export const TIER_LABEL: Record<PromotionTier, string> = { boost: "Boost", featured: "Featured", premium: "Premium" };

/** Durations offered for advertised bands. Custom adverts can ask for anything up to MAX_AD_DAYS. */
export const AD_DURATIONS = [7, 14, 30];
export const MAX_AD_DAYS = 90;

export function bandPrice(weeklyCents: number, days: number) {
  return Math.round((weeklyCents * days) / 7);
}

/** What an advert's state means right now; approved adverts are scheduled, live or ended by date. */
export type AdState = Exclude<PromotionStatus, "approved"> | "scheduled" | "live" | "ended";

export function adState(ad: { status: PromotionStatus; startsAt: Date | string | null; endsAt: Date | string | null }): AdState {
  if (ad.status !== "approved") return ad.status;
  const now = Date.now();
  if (ad.startsAt && new Date(ad.startsAt).getTime() > now) return "scheduled";
  if (ad.endsAt && new Date(ad.endsAt).getTime() < now) return "ended";
  return "live";
}

export const AD_STATE_LABEL: Record<AdState, string> = {
  pending_quote: "Awaiting quote",
  awaiting_payment: "Awaiting payment",
  payment_submitted: "Payment under review",
  scheduled: "Scheduled",
  live: "Live",
  ended: "Ended",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
