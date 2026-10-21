import { and, desc, eq } from "drizzle-orm";
import { ShoppingCartIcon } from "lucide-react";
import { Link } from "react-router";
import { EmptyState, PageHeader } from "~/components/page";
import { BillStatusBadge, DeliveryStatusBadge, OrderStatusBadge } from "~/components/status";
import { Badge } from "~/components/ui/badge";
import { db, schema } from "~/db/client.server";
import { orderStatus, type OrderStatus } from "~/db/schema";
import { requireMerchant } from "~/lib/auth.server";
import { formatDay } from "~/lib/dates";
import { date, money, ORDER_STATUS_LABEL } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/sell.orders";

export const meta: Route.MetaFunction = () => [{ title: "Orders · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const status = new URL(request.url).searchParams.get("status");
  const filter = orderStatus.enumValues.includes(status as OrderStatus) ? (status as OrderStatus) : null;

  const orders = await db.query.orders.findMany({
    where: and(eq(schema.orders.storeId, user.storeId), filter ? eq(schema.orders.status, filter) : undefined),
    orderBy: desc(schema.orders.createdAt),
    limit: 200,
    with: {
      customer: { columns: { name: true } },
      items: { columns: { title: true, quantity: true } },
      delivery: { columns: { status: true } },
      bill: { columns: { status: true, dueAt: true } },
    },
  });
  return { orders, filter };
}

export default function SellOrders({ loaderData }: Route.ComponentProps) {
  const { orders, filter } = loaderData;
  const tabs: (OrderStatus | null)[] = [null, "pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];

  return (
    <>
      <PageHeader title="Orders" description="Accept orders, update delivery progress and record payments." />
      <div className="scrollbar-none -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {tabs.map((t) => (
          <Link
            key={t ?? "all"}
            to={t ? `?status=${t}` : "."}
            className={cn(
              "shrink-0 rounded-full border-2 px-3 py-1 text-sm font-medium",
              filter === t ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/40",
            )}
          >
            {t ? ORDER_STATUS_LABEL[t] : "All"}
          </Link>
        ))}
      </div>
      {orders.length ? (
        <ul className="grid gap-2">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                to={`/sell/orders/${o.id}`}
                className="grid gap-2 rounded-xl border bg-card p-4 hover:border-primary/40 sm:grid-cols-[1fr_auto]"
              >
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{o.number}</span>
                    <OrderStatusBadge status={o.status} booking={!!o.bookingDate && !o.planId} />
                    {o.delivery && !(o.bookingDate && !o.planId) ? <DeliveryStatusBadge status={o.delivery.status} /> : null}
                    {o.bookingDate ? (
                      <Badge variant={o.planId ? "secondary" : "accent"}>
                        {o.planId ? "Repeat delivery" : "Booking"} · {formatDay(o.bookingDate)}
                      </Badge>
                    ) : null}
                    {o.paymentTiming === "prepaid" ? <Badge variant="outline">Prepaid</Badge> : null}
                    {o.bill ? <BillStatusBadge bill={o.bill} /> : null}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {o.customer.name} · {o.items.map((i) => `${i.quantity}× ${i.title}`).join(", ")}
                  </p>
                </div>
                <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-1">
                  <span className="font-extrabold">{money(o.totalCents, o.currency)}</span>
                  <span className="text-xs text-muted-foreground">{date(o.createdAt, true)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={ShoppingCartIcon} title="No orders here">
          Orders from customers will show up here.
        </EmptyState>
      )}
    </>
  );
}
