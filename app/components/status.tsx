import { CheckIcon } from "lucide-react";
import type { BillStatus, DeliveryStatus, OrderStatus } from "~/db/schema";
import {
  BILL_STATUS_LABEL,
  BOOKING_STATUS_LABEL,
  date,
  DELIVERY_STATUS_LABEL,
  effectiveBillStatus,
  ORDER_STATUS_LABEL,
} from "~/lib/format";
import { cn } from "~/lib/utils";
import { Badge } from "./ui/badge";

type Variant = React.ComponentProps<typeof Badge>["variant"];

const ORDER_VARIANT: Record<OrderStatus, Variant> = {
  pending: "warning",
  confirmed: "secondary",
  processing: "secondary",
  shipped: "accent",
  out_for_delivery: "accent",
  delivered: "success",
  cancelled: "muted",
};

const BILL_VARIANT: Record<BillStatus, Variant> = {
  unpaid: "warning",
  paid: "success",
  overdue: "destructive",
  defaulted: "destructive",
  void: "muted",
};

const DELIVERY_VARIANT: Record<DeliveryStatus, Variant> = {
  awaiting_dispatch: "muted",
  in_transit: "accent",
  delivered: "success",
  failed: "destructive",
  returned: "destructive",
};

/** Bookings use event wording: requested, confirmed, completed. */
export function statusLabel(status: OrderStatus, booking = false) {
  return (booking && BOOKING_STATUS_LABEL[status]) || ORDER_STATUS_LABEL[status];
}

export function OrderStatusBadge({ status, booking = false }: { status: OrderStatus; booking?: boolean }) {
  return <Badge variant={ORDER_VARIANT[status]}>{statusLabel(status, booking)}</Badge>;
}

export function BillStatusBadge({ bill }: { bill: { status: BillStatus; dueAt: Date | string } }) {
  const status = effectiveBillStatus(bill);
  return <Badge variant={BILL_VARIANT[status]}>{BILL_STATUS_LABEL[status]}</Badge>;
}

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return <Badge variant={DELIVERY_VARIANT[status]}>{DELIVERY_STATUS_LABEL[status]}</Badge>;
}

const TRACK_STEPS: OrderStatus[] = ["pending", "confirmed", "processing", "shipped", "out_for_delivery", "delivered"];
const BOOKING_STEPS: OrderStatus[] = ["pending", "confirmed", "delivered"];

/** Progress tracker plus a timeline of every status change. */
export function OrderTracker({
  status,
  events,
  booking = false,
}: {
  status: OrderStatus;
  events: { id: string; status: OrderStatus; note: string | null; createdAt: Date | string }[];
  booking?: boolean;
}) {
  const steps = booking ? BOOKING_STEPS : TRACK_STEPS;
  const current = steps.indexOf(status);

  return (
    <div className="grid gap-6">
      {status === "cancelled" ? (
        <p className="rounded-lg bg-muted p-3 text-sm font-medium">This {booking ? "booking" : "order"} was cancelled.</p>
      ) : (
        <ol className="flex items-start">
          {steps.map((step, i) => {
            const done = i <= current;
            return (
              <li key={step} className="relative flex flex-1 flex-col items-center gap-2 text-center">
                {i > 0 ? (
                  <span
                    className={cn(
                      "absolute top-3.5 right-1/2 -z-0 h-1 w-full rounded",
                      i <= current ? "bg-primary" : "bg-muted",
                    )}
                  />
                ) : null}
                <span
                  className={cn(
                    "relative z-10 flex size-8 items-center justify-center rounded-full border-2 text-xs font-bold",
                    done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground",
                    i === current && "ring-4 ring-primary/20",
                  )}
                >
                  {done ? <CheckIcon className="size-4" /> : i + 1}
                </span>
                <span className={cn("hidden text-xs sm:block", done ? "font-semibold" : "text-muted-foreground")}>
                  {statusLabel(step, booking)}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <ol className="grid gap-4 border-l-2 border-dashed pl-5">
        {[...events].reverse().map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute top-1 -left-[27px] size-3 rounded-full border-2 border-card bg-primary" />
            <p className="text-sm font-semibold">{statusLabel(e.status, booking)}</p>
            {e.note ? <p className="text-sm text-muted-foreground">{e.note}</p> : null}
            <p className="text-xs text-muted-foreground">{date(e.createdAt, true)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
