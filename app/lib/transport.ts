import type { TransportType } from "~/db/schema";

/**
 * Transport for hire from registered couriers, beyond store deliveries: parcel runs, house moves,
 * taxi rides and car hire. Customers post a request and couriers send prices; hire cars can also
 * be booked straight from a courier's listing.
 */
export const TRANSPORT_TYPES: { value: TransportType; label: string; short: string; hint: string }[] = [
  { value: "taxi", label: "Book a ride", short: "Taxi", hint: "A driver takes you from A to B, now or later" },
  { value: "moving", label: "House or office move", short: "Moving", hint: "Furniture, boxes and appliances, with a van or truck" },
  { value: "parcel", label: "Send or collect something", short: "Parcel", hint: "Anything not bought on MyPlug: documents, a bag, a fridge" },
  { value: "car_hire", label: "Hire a car", short: "Car hire", hint: "A car for one or more days, with or without a driver" },
];

export const TRANSPORT_LABEL = Object.fromEntries(TRANSPORT_TYPES.map((t) => [t.value, t.short])) as Record<TransportType, string>;

export function isTransportType(v: unknown): v is TransportType {
  return TRANSPORT_TYPES.some((t) => t.value === v);
}

export const VEHICLE_TYPES = ["Motorbike", "Car", "Minibus", "Pickup", "Van", "Truck"] as const;

/** Days in an inclusive date range, e.g. 2026-11-02 to 2026-11-04 is 3 days. */
export function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export const JOB_STATUS = {
  open: { label: "Waiting for offers", tone: "warning" },
  booked: { label: "Booked", tone: "success" },
  completed: { label: "Done", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "destructive" },
} as const;

export const BOOKING_STATUS = {
  requested: { label: "Waiting for the owner", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "success" },
  declined: { label: "Not available", tone: "destructive" },
  cancelled: { label: "Cancelled", tone: "muted" },
  completed: { label: "Done", tone: "muted" },
} as const;
