/** Listing plan constants shared by the server and the pages. */
import { DEFAULT_CURRENCY, money } from "./format";

export const PHOTO_LIMITS = { min: 1, max: 30, fallback: 8 };
export const MAX_MONTHS = 12;

export const bandPrice = (cents: number) => (cents ? `${money(cents, DEFAULT_CURRENCY)}/month` : "Free");
