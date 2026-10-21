import { desc, eq } from "drizzle-orm";
import { ChevronRightIcon, PackageIcon } from "lucide-react";
import { Link } from "react-router";
import { Container, EmptyState, PageHeader } from "~/components/page";
import { BillStatusBadge, OrderStatusBadge } from "~/components/status";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { db, schema } from "~/db/client.server";
import { requireCustomer } from "~/lib/auth.server";
import { formatDay } from "~/lib/dates";
import { date, money } from "~/lib/format";
import type { Route } from "./+types/account.orders";

export const meta: Route.MetaFunction = () => [{ title: "My orders · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  const orders = await db.query.orders.findMany({
    where: eq(schema.orders.customerId, user.id),
    orderBy: desc(schema.orders.createdAt),
    with: {
      store: { columns: { name: true } },
      items: { columns: { title: true, quantity: true } },
      bill: { columns: { status: true, dueAt: true } },
    },
  });
  return { orders };
}

export default function MyOrders({ loaderData }: Route.ComponentProps) {
  const { orders } = loaderData;
  return (
    <Container className="max-w-4xl py-8">
      <PageHeader title="My orders" description="Track deliveries and bills for everything you've ordered." />
      {orders.length ? (
        <ul className="grid gap-3">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                to={`/account/orders/${o.id}`}
                className="flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
                  <PackageIcon className="size-6" />
                </span>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{o.number}</span>
                    <OrderStatusBadge status={o.status} booking={!!o.bookingDate && !o.planId} />
                    {o.bill ? <BillStatusBadge bill={o.bill} /> : null}
                    {o.bookingDate ? (
                      <Badge variant={o.planId ? "secondary" : "accent"}>
                        {o.planId ? "Repeat delivery" : "Booking"} · {formatDay(o.bookingDate)}
                      </Badge>
                    ) : null}
                    {o.paymentTiming === "prepaid" ? <Badge variant="outline">Prepaid</Badge> : null}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {o.items.map((i) => `${i.quantity}× ${i.title}`).join(", ")} · {o.store.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{date(o.createdAt)}</p>
                </div>
                <span className="font-extrabold">{money(o.totalCents, o.currency)}</span>
                <ChevronRightIcon className="size-5 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={PackageIcon} title="No orders yet">
          <Button asChild className="mt-2">
            <Link to="/">Start shopping</Link>
          </Button>
        </EmptyState>
      )}
    </Container>
  );
}
