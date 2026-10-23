/** Real estate labels and features, shared by the server and the pages. */
import type { ListingType, PriceType, PropertyFeatures } from "~/db/schema";

export const LISTING_TYPES: { value: ListingType; label: string; text: string }[] = [
  { value: "land", label: "Land / plot for sale", text: "A description is the main thing; photos optional" },
  { value: "house", label: "House for sale", text: "Description with interior and exterior photos" },
  { value: "rental", label: "House to rent", text: "Monthly rent, with the key features tenants ask about" },
];

export const LISTING_BADGE: Record<ListingType, string> = { land: "Land for sale", house: "House for sale", rental: "To rent" };

export const PRICE_TYPES: { value: PriceType; label: string; text: string }[] = [
  { value: "negotiable", label: "Negotiable", text: "Buyers can offer any amount" },
  { value: "fixed", label: "Non-negotiable", text: "Buyers can only show interest at your price" },
  { value: "reserve", label: "Reserve price (bidding)", text: "Buyers bid until a closing date; your lowest acceptable price stays secret" },
];

export const PRICE_TYPE_LABEL: Record<PriceType, string> = { negotiable: "Negotiable", fixed: "Non-negotiable", reserve: "Bidding (reserve price)" };

/** Yes/no features shown as a checklist. Which ones apply depends on the listing type. */
export const FEATURE_FLAGS: { key: keyof PropertyFeatures; label: string; for: ListingType[] }[] = [
  { key: "backupPower", label: "Backup power (solar / inverter / generator)", for: ["house", "rental"] },
  { key: "waterTank", label: "Water tank", for: ["house", "rental"] },
  { key: "borehole", label: "Borehole", for: ["land", "house", "rental"] },
  { key: "masterEnsuite", label: "Master bedroom en-suite", for: ["house", "rental"] },
  { key: "separateDining", label: "Dining room separate from the lounge", for: ["house", "rental"] },
  { key: "parking", label: "Parking / garage", for: ["house", "rental"] },
  { key: "securityWall", label: "Wall or fence with gate", for: ["land", "house", "rental"] },
  { key: "servantsQuarters", label: "Staff quarters", for: ["house", "rental"] },
  { key: "furnished", label: "Furnished", for: ["rental"] },
];

/** Land and houses for sale must say whether a title deed is available. */
export const needsTitleDeed = (t: ListingType | null | undefined) => t === "land" || t === "house";

export const soldWord = (t: ListingType | null | undefined) => (t === "rental" ? "Let" : "Sold");

/** Price line for cards and pages, e.g. "MK 450,000 / month". */
export const priceSuffix = (t: ListingType | null | undefined) => (t === "rental" ? " / month" : "");

export function featuresFromForm(form: FormData, type: ListingType): PropertyFeatures {
  const n = (k: string) => {
    const v = Number(form.get(k));
    return Number.isInteger(v) && v >= 0 && v <= 50 ? v : undefined;
  };
  const text = (k: string, max = 200) => String(form.get(k) ?? "").trim().slice(0, max) || undefined;
  const f: PropertyFeatures = { location: text("location"), plotSize: text("plotSize", 60), other: text("otherFeatures", 1000) };
  if (type !== "land") {
    f.bedrooms = n("bedrooms");
    f.bathrooms = n("bathrooms");
  }
  for (const flag of FEATURE_FLAGS) if (flag.for.includes(type)) (f as Record<string, unknown>)[flag.key] = form.get(flag.key) === "on";
  return f;
}
