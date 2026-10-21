import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { UsersIcon } from "lucide-react";
import { Form, Link, useSearchParams } from "react-router";
import { AccountActions } from "~/components/account-actions";
import { EmptyState, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { qualified } from "~/db/sql";
import { handleAccountAction, likeTerm } from "~/lib/admin.server";
import { requireAdmin } from "~/lib/auth.server";
import { date } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/admin.customers";

export const meta: Route.MetaFunction = () => [{ title: "Customers · Admin · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const filter = status === "active" || status === "suspended" ? status : null;
  const q = url.searchParams.get("q")?.trim() ?? "";
  const { users, orders, bills, requests } = schema;

  const customers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      status: users.status,
      joined: users.createdAt,
      orderCount: sql<number>`(select count(*) from ${orders} where ${qualified(orders.customerId)} = ${qualified(users.id)})::int`,
      requestCount: sql<number>`(select count(*) from ${requests} where ${qualified(requests.customerId)} = ${qualified(users.id)})::int`,
      // Bills not honoured: marked defaulted, or unpaid past their due date
      badBills: sql<number>`(select count(*) from ${bills} join ${orders} on ${qualified(orders.id)} = ${qualified(bills.orderId)}
        where ${qualified(orders.customerId)} = ${qualified(users.id)}
        and (${qualified(bills.status)} = 'defaulted' or (${qualified(bills.status)} = 'unpaid' and ${qualified(bills.dueAt)} < now())))::int`,
    })
    .from(users)
    .where(
      and(
        eq(users.role, "customer"),
        filter ? eq(users.status, filter) : undefined,
        q ? or(ilike(users.name, likeTerm(q)), ilike(users.email, likeTerm(q)), ilike(users.phone, likeTerm(q))) : undefined,
      ),
    )
    .orderBy(desc(users.createdAt))
    .limit(100);

  return { customers, filter, q };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  return handleAccountAction(admin, await request.formData());
}

export default function AdminCustomers({ loaderData }: Route.ComponentProps) {
  const { customers, filter, q } = loaderData;
  const [params] = useSearchParams();
  const tabHref = (t: string | null) => {
    const p = new URLSearchParams(params);
    if (t) p.set("status", t);
    else p.delete("status");
    return `?${p}`;
  };

  return (
    <>
      <PageHeader title="Customers" description="Look up a customer's orders and bills, and suspend accounts that abuse the platform." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {[null, "active", "suspended"].map((t) => (
            <Link
              key={t ?? "all"}
              to={tabHref(t)}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-semibold capitalize",
                filter === t ? "bg-foreground text-background" : "bg-muted hover:bg-muted/70",
              )}
            >
              {t ?? "All"}
            </Link>
          ))}
        </div>
        <Form className="ml-auto w-full sm:w-64">
          {filter ? <input type="hidden" name="status" value={filter} /> : null}
          <Input name="q" type="search" defaultValue={q} placeholder="Search name, email or phone" className="h-9" />
        </Form>
      </div>

      {customers.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No customers found">
          Try another filter or search.
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {customers.map((c) => (
            <li key={c.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
              <div className="grid content-start gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/admin/users/${c.id}`} className="font-bold hover:text-primary">{c.name}</Link>
                  {c.status === "suspended" ? <Badge variant="destructive">Suspended</Badge> : null}
                  {c.badBills ? <Badge variant="warning">{c.badBills} unpaid/defaulted bill{c.badBills > 1 ? "s" : ""}</Badge> : null}
                </div>
                <p className="text-sm">
                  <a href={`mailto:${c.email}`} className="text-accent hover:underline">{c.email}</a>
                  {c.phone ? ` · ${c.phone}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Joined {date(c.joined)} · {c.orderCount} orders · {c.requestCount} requests
                </p>
                <Link to={`/admin/users/${c.id}`} className="text-sm font-semibold text-primary hover:underline">
                  Orders & details
                </Link>
              </div>
              <AccountActions userId={c.id} userStatus={c.status} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
