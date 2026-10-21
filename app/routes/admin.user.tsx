import { desc, eq } from "drizzle-orm";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { data, Link } from "react-router";
import { AccountActions, StoreStatusBadge } from "~/components/account-actions";
import { AdStateBadge } from "~/components/ad-status";
import { PageHeader } from "~/components/page";
import { SafeImage } from "~/components/safe-image";
import { BillStatusBadge, OrderStatusBadge } from "~/components/status";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { handleAccountAction } from "~/lib/admin.server";
import { requireAdmin } from "~/lib/auth.server";
import { date, money } from "~/lib/format";
import { adState } from "~/lib/promotions";
import type { Route } from "./+types/admin.user";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.user.name} · Admin · MyPlug` : "Account · Admin · MyPlug" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request);
  const { users, orders, promotions, products, requests } = schema;
  const user = await db.query.users.findFirst({
    where: eq(users.id, params.id),
    columns: { passwordHash: false },
    with: { store: true },
  });
  if (!user) throw data("Account not found", { status: 404 });

  const orderWith = {
    items: { columns: { title: true, quantity: true } },
    bill: { columns: { status: true, dueAt: true } },
  } as const;

  if (user.store) {
    const store = user.store;
    const [storeOrders, ads, productCount] = await Promise.all([
      db.query.orders.findMany({
        where: eq(orders.storeId, store.id),
        orderBy: desc(orders.createdAt),
        limit: 20,
        with: { ...orderWith, customer: { columns: { id: true, name: true } } },
      }),
      db
        .select({
          id: promotions.id,
          number: promotions.number,
          status: promotions.status,
          startsAt: promotions.startsAt,
          endsAt: promotions.endsAt,
          amountCents: promotions.amountCents,
          title: products.title,
        })
        .from(promotions)
        .innerJoin(products, eq(products.id, promotions.productId))
        .where(eq(products.storeId, store.id))
        .orderBy(desc(promotions.createdAt))
        .limit(20),
      db.$count(products, eq(products.storeId, store.id)),
    ]);
    return { user, orders: storeOrders.map((o) => ({ ...o, other: o.customer, otherHref: `/admin/users/${o.customer.id}` })), ads, productCount, requests: [] };
  }

  const [customerOrders, customerRequests] = await Promise.all([
    db.query.orders.findMany({
      where: eq(orders.customerId, user.id),
      orderBy: desc(orders.createdAt),
      limit: 20,
      with: { ...orderWith, store: { columns: { name: true, slug: true } } },
    }),
    db.query.requests.findMany({
      where: eq(requests.customerId, user.id),
      orderBy: desc(requests.createdAt),
      limit: 20,
      columns: { id: true, title: true, status: true, createdAt: true },
    }),
  ]);
  return {
    user,
    orders: customerOrders.map((o) => ({ ...o, other: o.store, otherHref: `/s/${o.store.slug}` })),
    ads: [],
    productCount: 0,
    requests: customerRequests,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  return handleAccountAction(admin, await request.formData());
}

export default function AdminUser({ loaderData }: Route.ComponentProps) {
  const { user, orders, ads, productCount, requests } = loaderData;
  const store = user.store;

  return (
    <>
      <Link to={store ? "/admin/merchants" : "/admin/customers"} className="mb-3 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeftIcon className="size-4" /> {store ? "Merchants" : "Customers"}
      </Link>
      <PageHeader title={store?.name ?? user.name} description={store ? `Run by ${user.name}` : "Customer account"} />

      <Card className="mb-6">
        <CardContent className="grid gap-4 pt-5 md:grid-cols-[1fr_auto]">
          <div className="flex gap-4">
            {store ? <SafeImage src={store.logoUrl} alt="" className="size-20 shrink-0 rounded-xl border" /> : null}
            <div className="grid content-start gap-1.5 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="capitalize">{user.role}</Badge>
                {user.status === "suspended" ? <Badge variant="destructive">Account suspended</Badge> : <Badge variant="success">Active</Badge>}
                {store ? <StoreStatusBadge status={store.status} /> : null}
              </div>
              <p>
                <a href={`mailto:${user.email}`} className="text-accent hover:underline">{user.email}</a>
                {user.phone ? ` · ${user.phone}` : ""}
              </p>
              <p className="text-muted-foreground">Joined {date(user.createdAt)}</p>
              {store ? (
                <>
                  {store.description ? <p className="text-muted-foreground">{store.description}</p> : null}
                  <p className="text-muted-foreground">
                    {productCount} products · sells in {store.currency}
                  </p>
                  {store.reviewNote ? <p>Note: {store.reviewNote}</p> : null}
                  <Link to={`/s/${store.slug}`} className="flex w-fit items-center gap-1 font-semibold text-accent hover:underline">
                    View store <ExternalLinkIcon className="size-3.5" />
                  </Link>
                </>
              ) : null}
            </div>
          </div>
          {user.role !== "admin" ? (
            <AccountActions userId={user.id} userStatus={user.status} storeStatus={store?.status} />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{store ? "Orders received" : "Orders placed"}</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Order</th>
                    <th className="py-2 pr-3">{store ? "Customer" : "Store"}</th>
                    <th className="py-2 pr-3">Items</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Bill</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs font-semibold">{o.number}</span>
                        <br />
                        <span className="text-xs text-muted-foreground">{date(o.createdAt)}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <Link to={o.otherHref} className="hover:text-primary">{o.other.name}</Link>
                      </td>
                      <td className="max-w-48 truncate py-2 pr-3">{o.items.map((i) => `${i.quantity}× ${i.title}`).join(", ")}</td>
                      <td className="py-2 pr-3"><OrderStatusBadge status={o.status} /></td>
                      <td className="py-2 pr-3">{o.bill ? <BillStatusBadge bill={o.bill} /> : null}</td>
                      <td className="py-2 text-right font-semibold">{money(o.totalCents, o.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          )}
        </CardContent>
      </Card>

      {store ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Adverts</CardTitle>
          </CardHeader>
          <CardContent>
            {ads.length ? (
              <ul className="divide-y text-sm">
                {ads.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                    <AdStateBadge state={adState(a)} />
                    <Link to={`/admin/ads?q=${a.number}`} className="font-mono text-xs font-semibold hover:text-primary">{a.number}</Link>
                    <span>{a.title}</span>
                    <span className="ml-auto font-semibold">{a.amountCents != null ? money(a.amountCents) : "Not quoted"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No adverts.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Requests posted</CardTitle>
          </CardHeader>
          <CardContent>
            {requests.length ? (
              <ul className="divide-y text-sm">
                {requests.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    <Link to={`/requests/${r.id}`} className="font-semibold hover:text-primary">{r.title}</Link>
                    <Badge variant="muted" className="capitalize">{r.status}</Badge>
                    <span className="ml-auto text-xs text-muted-foreground">{date(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No requests.</p>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
