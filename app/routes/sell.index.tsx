import { and, desc, eq, sql } from "drizzle-orm";
import {
  AlertTriangleIcon,
  BanknoteIcon,
  CircleCheckIcon,
  ClockIcon,
  PackageIcon,
  PlusIcon,
  TruckIcon,
  XCircleIcon,
} from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "~/components/page";
import { BillStatusBadge, OrderStatusBadge } from "~/components/status";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { requireMerchant } from "~/lib/auth.server";
import { date, money } from "~/lib/format";
import type { Route } from "./+types/sell.index";

export const meta: Route.MetaFunction = () => [{ title: "Seller dashboard · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const { products, orders, bills, deliveries } = schema;
  const mine = eq(orders.storeId, user.storeId);

  const [[stock], [orderStats], [billStats], recent] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        outOfStock: sql<number>`count(*) filter (where ${products.trackStock} and ${products.quantity} <= 0)::int`,
        low: sql<number>`count(*) filter (where ${products.trackStock} and ${products.quantity} between 1 and 5)::int`,
      })
      .from(products)
      .where(and(eq(products.storeId, user.storeId), eq(products.isActive, true))),
    db
      .select({
        awaiting: sql<number>`count(*) filter (where ${orders.status} = 'pending')::int`,
        inProgress: sql<number>`count(*) filter (where ${orders.status} in ('confirmed','processing','shipped','out_for_delivery'))::int`,
        delivered: sql<number>`count(*) filter (where ${deliveries.status} = 'delivered')::int`,
        failed: sql<number>`count(*) filter (where ${deliveries.status} in ('failed','returned'))::int`,
      })
      .from(orders)
      .leftJoin(deliveries, eq(deliveries.orderId, orders.id))
      .where(mine),
    db
      .select({
        paidCents: sql<number>`coalesce(sum(${bills.amountCents}) filter (where ${bills.status} = 'paid'), 0)::float8`,
        paid: sql<number>`count(*) filter (where ${bills.status} = 'paid')::int`,
        outstandingCents: sql<number>`coalesce(sum(${bills.amountCents}) filter (where ${bills.status} = 'unpaid' and ${bills.dueAt} >= now()), 0)::float8`,
        overdue: sql<number>`count(*) filter (where ${bills.status} = 'unpaid' and ${bills.dueAt} < now())::int`,
        overdueCents: sql<number>`coalesce(sum(${bills.amountCents}) filter (where ${bills.status} = 'unpaid' and ${bills.dueAt} < now()), 0)::float8`,
        defaulted: sql<number>`count(*) filter (where ${bills.status} = 'defaulted')::int`,
        defaultedCents: sql<number>`coalesce(sum(${bills.amountCents}) filter (where ${bills.status} = 'defaulted'), 0)::float8`,
      })
      .from(bills)
      .innerJoin(orders, eq(orders.id, bills.orderId))
      // Totals only add up orders in the store's current currency.
      .where(and(mine, eq(orders.currency, user.storeCurrency))),
    db.query.orders.findMany({
      where: eq(orders.storeId, user.storeId),
      orderBy: desc(orders.createdAt),
      limit: 6,
      with: { customer: { columns: { name: true } }, bill: { columns: { status: true, dueAt: true } } },
    }),
  ]);

  return { stock, orderStats, billStats, recent, currency: user.storeCurrency };
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span className={`flex size-10 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-xl font-black">{value}</p>
        </div>
      </div>
      {sub ? <p className="mt-2 text-xs text-muted-foreground">{sub}</p> : null}
    </Card>
  );
}

export default function SellOverview({ loaderData }: Route.ComponentProps) {
  const { stock, orderStats, billStats, recent, currency } = loaderData;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Orders, deliveries and bills at a glance."
        actions={
          <Button asChild>
            <Link to="/sell/products/new">
              <PlusIcon /> New product
            </Link>
          </Button>
        }
      />

      <h2 className="mb-3 font-bold">Orders & deliveries</h2>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={ClockIcon} label="Awaiting you" value={orderStats.awaiting} tone="bg-warning/20 text-highlight-foreground dark:text-warning" />
        <Stat icon={TruckIcon} label="In progress" value={orderStats.inProgress} tone="bg-accent/15 text-accent" />
        <Stat icon={CircleCheckIcon} label="Deliveries made" value={orderStats.delivered} tone="bg-success/15 text-success" />
        <Stat icon={XCircleIcon} label="Failed / returned" value={orderStats.failed} tone="bg-destructive/10 text-destructive" />
      </div>

      <h2 className="mb-3 font-bold">Bills</h2>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={BanknoteIcon} label="Honoured (paid)" value={money(billStats.paidCents, currency)} sub={`${billStats.paid} bills`} tone="bg-success/15 text-success" />
        <Stat icon={ClockIcon} label="Outstanding" value={money(billStats.outstandingCents, currency)} sub="Not yet due" tone="bg-secondary text-secondary-foreground" />
        <Stat icon={AlertTriangleIcon} label="Overdue" value={money(billStats.overdueCents, currency)} sub={`${billStats.overdue} bills`} tone="bg-warning/20 text-highlight-foreground dark:text-warning" />
        <Stat icon={XCircleIcon} label="Not honoured" value={money(billStats.defaultedCents, currency)} sub={`${billStats.defaulted} bills`} tone="bg-destructive/10 text-destructive" />
      </div>

      <h2 className="mb-3 font-bold">Stock</h2>
      <div className="mb-8 grid grid-cols-3 gap-3">
        <Stat icon={PackageIcon} label="Live products" value={stock.total} tone="bg-primary/12 text-primary" />
        <Stat icon={AlertTriangleIcon} label="Low stock" value={stock.low} tone="bg-warning/20 text-highlight-foreground dark:text-warning" />
        <Stat icon={XCircleIcon} label="Out of stock" value={stock.outOfStock} tone="bg-destructive/10 text-destructive" />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent orders</CardTitle>
          <Link to="/sell/orders" className="text-sm font-semibold text-primary hover:underline">View all</Link>
        </CardHeader>
        <CardContent>
          {recent.length ? (
            <ul className="divide-y">
              {recent.map((o) => (
                <li key={o.id}>
                  <Link to={`/sell/orders/${o.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:text-primary">
                    <span className="font-bold">{o.number}</span>
                    <span className="text-sm text-muted-foreground">{o.customer.name}</span>
                    <OrderStatusBadge status={o.status} />
                    {o.bill ? <BillStatusBadge bill={o.bill} /> : null}
                    <span className="ml-auto text-sm text-muted-foreground">{date(o.createdAt)}</span>
                    <span className="font-bold">{money(o.totalCents, o.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No orders yet. Share your store link to get started!</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
