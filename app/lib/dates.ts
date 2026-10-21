import type { PlanFrequency } from "~/db/schema";

/** Calendar dates as "YYYY-MM-DD" strings, so they never shift with time zones. */
export type DateStr = string;

/** The marketplace's own time zone decides what "today" is (bookings, daily deliveries). */
export const APP_TIME_ZONE = "Africa/Blantyre";

export function today(timeZone = APP_TIME_ZONE): DateStr {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function isDateStr(s: unknown): s is DateStr {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

export function addDays(day: DateStr, n: number): DateStr {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(day: DateStr) {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function formatDay(day: DateStr, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}

/** First delivery day on or after `from` for a plan that started on `anchor`. */
export function nextOccurrence(frequency: PlanFrequency, from: DateStr, anchor: DateStr): DateStr {
  let day = from;
  for (let i = 0; i < 8; i++) {
    const wd = weekday(day);
    if (frequency === "daily") return day;
    if (frequency === "weekdays" && wd >= 1 && wd <= 5) return day;
    if (frequency === "weekly" && wd === weekday(anchor)) return day;
    day = addDays(day, 1);
  }
  return day;
}

export const FREQUENCIES: PlanFrequency[] = ["daily", "weekdays", "weekly"];

export const FREQUENCY_LABEL: Record<PlanFrequency, string> = {
  daily: "Every day",
  weekdays: "Every weekday (Mon–Fri)",
  weekly: "Once a week",
};
