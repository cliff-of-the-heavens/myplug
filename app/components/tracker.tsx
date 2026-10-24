import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import type { TrackBatch, TrackEvent } from "~/lib/analytics";

/**
 * Privacy-friendly, low-cost analytics. Events wait in memory and go to /api/t in one small
 * batch via navigator.sendBeacon: when the visitor leaves or hides the page, or every 30
 * seconds while there's something to send. Nothing here runs while a page is rendering, and
 * people with "Do Not Track" (or Global Privacy Control) switched on are never tracked.
 */
const queue: TrackEvent[] = [];
let listening = false;
let enabled = true; // the admin's "Record analytics" switch, set by <Tracker>

function optedOut() {
  if (typeof navigator === "undefined") return true;
  const n = navigator as Navigator & { globalPrivacyControl?: boolean };
  return n.doNotTrack === "1" || n.globalPrivacyControl === true;
}

function storage(key: string, value?: string) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: fall back to a per-page id.
  }
  return null;
}

let fallbackId: string | null = null; // used when the browser blocks storage

function visitorId() {
  const saved = storage("mp_vid");
  if (saved) return saved;
  const id = fallbackId ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^\w-]/g, "");
  fallbackId = id;
  storage("mp_vid", id);
  return id;
}

function flush() {
  if (!enabled) queue.length = 0;
  if (!queue.length || optedOut()) return;
  const day = new Date().toISOString().slice(0, 10);
  const newDay = storage("mp_vday") !== day;
  const batch: TrackBatch = { v: visitorId(), newDay, e: queue.splice(0, 60) };
  const body = new Blob([JSON.stringify(batch)], { type: "text/plain" }); // text/plain: no CORS preflight
  const sent = navigator.sendBeacon?.("/api/t", body);
  if (!sent) fetch("/api/t", { method: "POST", body, keepalive: true }).catch(() => {});
  if (newDay) storage("mp_vday", day);
  if (queue.length) flush();
}

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  window.addEventListener("pagehide", flush);
  setInterval(flush, 30_000);
}

export function track(e: TrackEvent) {
  if (!enabled || optedOut()) return;
  listen();
  queue.push(e);
}

/**
 * Counts a page view on every navigation. Rendered once, in the root layout. When the admin
 * switches analytics off, nothing is queued or sent at all (not just ignored by the server).
 */
export function Tracker({ enabled: on }: { enabled: boolean }) {
  const location = useLocation();
  useEffect(() => {
    enabled = on;
    if (on) track({ t: "page" });
    else queue.length = 0;
  }, [on, location.pathname, location.search]);
  return null;
}

/** Counts a view of a store (and product): put on store and product pages. */
export function TrackView({ storeId, productId }: { storeId: string; productId?: string }) {
  useEffect(() => {
    track({ t: "store", id: storeId });
    if (productId) track({ t: "product", id: productId });
  }, [storeId, productId]);
  return null;
}

/**
 * Measures how long a banner ad is actually on screen (at least half visible, tab in view).
 * A view counts once it has been visible for a second, the usual standard for ad viewability.
 */
export function useAdViewTime(adId: string | undefined) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !adId || typeof IntersectionObserver === "undefined" || optedOut()) return;
    let visibleSince: number | null = null;
    let total = 0;
    const stop = () => {
      if (visibleSince != null) total += performance.now() - visibleSince;
      visibleSince = null;
    };
    const report = () => {
      stop();
      if (total >= 1000) track({ t: "ad", id: adId, ms: Math.round(total) });
      total = 0;
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && document.visibilityState === "visible") visibleSince ??= performance.now();
        else stop();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    // Hand the time over before the batch is sent when the page is hidden.
    const onHide = () => document.visibilityState === "hidden" && report();
    document.addEventListener("visibilitychange", onHide, { capture: true });
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onHide, { capture: true });
      report();
    };
  }, [adId]);
  return ref;
}
