import type { BillStatus, DeliveryStatus, OrderStatus } from "~/db/schema";

/** Currencies a store can sell in. Prices are stored in minor units (cents/tambala) of the store's currency. */
export const CURRENCIES = [
  { code: "MWK", name: "Malawian Kwacha", symbol: "MK" },
  { code: "ZAR", name: "South African Rand", symbol: "R" },
  { code: "ZMW", name: "Zambian Kwacha", symbol: "ZK" },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh" },
  { code: "UGX", name: "Ugandan Shilling", symbol: "USh" },
  { code: "MZN", name: "Mozambican Metical", symbol: "MT" },
  { code: "BWP", name: "Botswana Pula", symbol: "P" },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "EUR", name: "Euro", symbol: "€" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];
export const DEFAULT_CURRENCY: CurrencyCode = "MWK";

export function isCurrency(code: unknown): code is CurrencyCode {
  return CURRENCIES.some((c) => c.code === code);
}

export function currencySymbol(code: string) {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

const wholeNumber = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const withDecimals = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formats minor units as e.g. "MK 25,000" or "R 899.50" (decimals only when there are any). */
export function money(cents: number, currency: string = DEFAULT_CURRENCY) {
  const amount = (cents % 100 === 0 ? wholeNumber : withDecimals).format(Math.abs(cents) / 100);
  return `${cents < 0 ? "-" : ""}${currencySymbol(currency)} ${amount}`;
}

/** Parses "12.50" / "12,50" / "MK 25,000" into cents. Returns null if invalid. */
export function parseMoney(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/\d/.test(value)) return null;
  let v = value.replace(/[^\d.,]/g, "");
  // A comma followed by 1-2 trailing digits is a decimal comma; any other comma groups thousands.
  v = !v.includes(".") && /,\d{1,2}$/.test(v) ? v.replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "") : v.replace(/,/g, "");
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1e12 ? Math.round(n * 100) : null;
}

export function date(d: Date | string, withTime = false) {
  return new Date(d).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function timeAgo(d: Date | string) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return date(d);
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Awaiting merchant",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Wording for service bookings where it differs from product orders. */
export const BOOKING_STATUS_LABEL: Partial<Record<OrderStatus, string>> = {
  pending: "Requested",
  confirmed: "Confirmed",
  delivered: "Completed",
};

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  awaiting_dispatch: "Awaiting dispatch",
  in_transit: "In transit",
  delivered: "Delivered",
  failed: "Delivery failed",
  returned: "Returned",
};

export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  unpaid: "Unpaid",
  paid: "Paid (honoured)",
  overdue: "Overdue",
  defaulted: "Not honoured",
  void: "Void",
};

/** A bill that is unpaid past its due date is shown as overdue. */
export function effectiveBillStatus(bill: { status: BillStatus; dueAt: Date | string }): BillStatus {
  if (bill.status === "unpaid" && new Date(bill.dueAt).getTime() < Date.now()) return "overdue";
  return bill.status;
}

/** trackStock=false means continuous supply: always in stock, no count shown. */
export function stockLabel(quantity: number, trackStock = true) {
  if (!trackStock) return { text: "In stock", tone: "in" as const };
  if (quantity <= 0) return { text: "Out of stock", tone: "out" as const };
  if (quantity <= 5) return { text: `Only ${quantity} left`, tone: "low" as const };
  return { text: "In stock", tone: "in" as const };
}
