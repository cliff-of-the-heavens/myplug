import type { MediaType } from "~/db/schema";

/** File types accepted for each kind of digital product (documents are PDFs so they can be previewed). */
export const MEDIA_TYPES: Record<MediaType, string[]> = {
  video: ["video/mp4", "video/webm"],
  audio: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/ogg", "audio/wav"],
  document: ["application/pdf"],
};

export const MEDIA_LABEL: Record<MediaType, string> = { video: "Video", audio: "Audio", document: "Document (PDF)" };

/** Largest full file a merchant can upload (direct to storage). */
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

export type OfferDraft = { label: string; mode: "download" | "stream"; price: string; accessDays: string; maxViews: string };

/** Describes what a buyer gets, e.g. "Watch online · 48 hours · 3 plays". */
export function offerTerms(o: { mode: "download" | "stream"; accessDays: number | null; maxViews: number | null }, type: MediaType | null) {
  const verb = type === "audio" ? "Listen online" : type === "document" ? "Read online" : "Watch online";
  const parts = [o.mode === "download" ? "Download to keep" : verb];
  if (o.accessDays) parts.push(o.accessDays === 1 ? "24 hours" : `${o.accessDays} days`);
  if (o.mode === "stream" && o.maxViews) parts.push(`${o.maxViews} ${o.maxViews === 1 ? "view" : "views"}`);
  if (o.mode === "stream" && !o.accessDays && !o.maxViews) parts.push("unlimited");
  return parts.join(" · ");
}
