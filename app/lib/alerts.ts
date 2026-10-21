import type { AlertType } from "~/db/schema";

/** Alert types a customer can choose, and the subscription field that stores each choice. */
export const ALERT_TYPES: { type: AlertType; field: "newProducts" | "restocks" | "discounts"; label: string; text: string }[] = [
  { type: "new_product", field: "newProducts", label: "New arrivals", text: "When the store lists something new" },
  { type: "restock", field: "restocks", label: "Back in stock", text: "When a sold-out item is available again" },
  { type: "discount", field: "discounts", label: "Discounts", text: "When the store drops a price" },
];

export const ALERT_TYPE_LABEL = Object.fromEntries(ALERT_TYPES.map((t) => [t.type, t.label])) as Record<AlertType, string>;

/** Singular name for one alert, as in "a new-arrival alert". */
export const ALERT_NAME: Record<AlertType, string> = { new_product: "new-arrival", restock: "back-in-stock", discount: "discount" };

/** Most products one alert can feature. */
export const MAX_ALERT_ITEMS = 6;

/** Longest note a merchant can add to an alert. */
export const ALERT_MESSAGE_MAX = 280;
