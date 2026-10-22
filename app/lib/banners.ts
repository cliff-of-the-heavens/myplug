/** Banner ad helpers shared by the server and the pages. */

export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  requested: "Waiting for review",
  awaiting_payment: "Awaiting payment",
  payment_submitted: "Payment being checked",
  approved: "Approved",
  rejected: "Not accepted",
  cancelled: "Cancelled",
};

/** Creative must be this close to the recommended shape (width / height), and at least this wide. */
export const ASPECT_TOLERANCE = 0.08;
export const MIN_WIDTH_RATIO = 0.75;

export const MAX_WEEKS = 26;

/** How to prepare a banner, shown on the advertise page and the upload page. */
export const PREPARATION_TIPS = [
  "Use the exact pixel size listed for the spot (or the same shape, at least three-quarters as wide). Other shapes are refused.",
  "Save photos as JPG and designs with flat colours or text as PNG or WebP. Keep under the size limit; tools like squoosh.app shrink files without visible loss.",
  "Keep text short (around 7 words) and large: at least 1/10 of the banner height. Phones show banners small.",
  "Keep important text and logos away from the edges (leave about 5% margin on every side): edges can be trimmed on small screens.",
  "No flashing images, sound, auto-playing video, pop-ups or fake buttons. Every banner is labelled \"Ad\".",
  "Nothing misleading, adult, hateful or illegal; prices shown must be real. Admins check every banner before it runs.",
];

/** Spots we don't sell, by design, to keep MyPlug pleasant to use. */
export const NON_INTRUSIVE_POLICY =
  "MyPlug never shows pop-ups, full-screen ads, ads between checkout steps, auto-playing video or sound. At most one banner is visible per screen, and side banners only appear on larger screens.";

/** Plans for hiding side and in-page banners (the price per 30 days is set by admins). */
export const AD_FREE_PLANS = [
  { days: 30, label: "1 month", multiplier: 1 },
  { days: 90, label: "3 months", multiplier: 2.7 }, // 10% off
  { days: 365, label: "1 year", multiplier: 10 }, // 2 months free
] as const;

/** A banner's click target must be a MyPlug path or an https:// address. */
export function cleanLink(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\/(?!\/)[\w\-./?=&%#~+]*$/.test(v)) return v;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function formatList(formats: string) {
  return formats
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean)
    .join(", ");
}
