import { desc, eq, sql } from "drizzle-orm";
import {
  BanknoteIcon,
  FlagIcon,
  HourglassIcon,
  MegaphoneIcon,
  ReceiptIcon,
  StoreIcon,
  UsersIcon,
  WandSparklesIcon,
} from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "~/components/page";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { liveAd } from "~/lib/ads.server";
import { getAdminCounts } from "~/lib/admin.server";
import { requireAdmin } from "~/lib/auth.server";
import { money, timeAgo } from "~/lib/format";
import type { Route } from "./+types/admin.index";

export const meta: Route.MetaFunction = () => [{ title: "Admin · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const { users, stores, promotions, products } = schema;
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);

  const [counts, [people], [ads], pendingStores, toVerify] = await Promise.all([
    getAdminCounts(),
    db
      .select({
        customers: sql<number>`count(*) filter (where ${users.role} = 'customer')::int`,
        merchants: sql<number>`(select count(*) from ${stores} where ${stores.status} = 'approved')::int`,
      })
      .from(users),
    db
      .select({
        live: sql<number>`count(*) filter (where ${liveAd})::int`,
        revenue: sql<number>`coalesce(sum(${promotions.amountCents}) filter (where ${promotions.status} = 'approved' and ${promotions.approvedAt} >= ${monthAgo}), 0)::float8`,
      })
      .from(promotions),
    db.query.stores.findMany({
      where: eq(stores.status, "pending"),
      orderBy: desc(stores.createdAt),
      limit: 5,
      with: { owner: { columns: { id: true, name: true } } },
    }),
    db
      .select({ id: promotions.id, number: promotions.number, amountCents: promotions.amountCents, at: promotions.paymentSubmittedAt, title: products.title })
      .from(promotions)
      .innerJoin(products, eq(products.id, promotions.productId))
      .where(eq(promotions.status, "payment_submitted"))
      .orderBy(promotions.paymentSubmittedAt)
      .limit(5),
  ]);
  return { counts, people, ads, pendingStores, toVerify };
}

function Stat({
  to,
  icon: Icon,
  label,
  value,
  tone,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  tone: string;
}) {
  return (
    <Link to={to} className="rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <div className="flex items-center gap-3">
        <span className={`flex size-10 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-xl font-black">{value}</p>
        </div>
      </div>
    </Link>
  );
}

export default function AdminOverview({ loaderData }: Route.ComponentProps) {
  const { counts, people, ads, pendingStores, toVerify } = loaderData;
  const attention = "bg-highlight/30 text-highlight-foreground";
  return (
    <>
      <PageHeader title="Overview" description="Everything waiting for you, and how the marketplace is doing." />

      <h2 className="mb-3 text-sm font-bold tracking-wider text-muted-foreground uppercase">Needs attention</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat to="/admin/merchants?status=pending" icon={HourglassIcon} label="Stores to approve" value={counts.pendingMerchants} tone={attention} />
        <Stat to="/admin/ads?status=pending_quote" icon={WandSparklesIcon} label="Custom ads to quote" value={counts.adsToQuote} tone={attention} />
        <Stat to="/admin/ads?status=payment_submitted" icon={ReceiptIcon} label="Payments to verify" value={counts.paymentsToVerify} tone={attention} />
        <Stat to="/admin/moderation" icon={FlagIcon} label="Reported items" value={counts.openReports} tone="bg-destructive/10 text-destructive" />
      </div>

      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wider text-muted-foreground uppercase">Marketplace</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat to="/admin/merchants?status=approved" icon={StoreIcon} label="Active stores" value={people.merchants} tone="bg-primary/10 text-primary" />
        <Stat to="/admin/customers" icon={UsersIcon} label="Customers" value={people.customers} tone="bg-accent/15 text-accent" />
        <Stat to="/admin/ads?status=live" icon={MegaphoneIcon} label="Live adverts" value={ads.live} tone="bg-success/15 text-success" />
        <Stat to="/admin/ads?status=approved" icon={BanknoteIcon} label="Ad revenue (30 days)" value={money(ads.revenue)} tone="bg-success/15 text-success" />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New stores waiting</CardTitle>
          </CardHeader>
          <CardContent>
            {pendingStores.length ? (
              <ul className="divide-y text-sm">
                {pendingStores.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2">
                    <Link to={`/admin/users/${s.owner.id}`} className="font-semibold hover:text-primary">{s.name}</Link>
                    <span className="text-muted-foreground">{s.owner.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{timeAgo(s.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No stores waiting for approval.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payments to verify</CardTitle>
          </CardHeader>
          <CardContent>
            {toVerify.length ? (
              <ul className="divide-y text-sm">
                {toVerify.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-2">
                    <Link to={`/admin/ads?status=payment_submitted#${a.number}`} className="font-mono text-xs font-semibold hover:text-primary">{a.number}</Link>
                    <span className="truncate">{a.title}</span>
                    <span className="ml-auto font-semibold">{money(a.amountCents ?? 0)}</span>
                    <span className="text-xs text-muted-foreground">{a.at ? timeAgo(a.at) : ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No payments waiting.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
