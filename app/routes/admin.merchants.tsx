import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { ExternalLinkIcon, StoreIcon } from "lucide-react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { AccountActions, StoreStatusBadge } from "~/components/account-actions";
import { EmptyState, PageHeader } from "~/components/page";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { qualified } from "~/db/sql";
import { storeStatus, type StoreStatus } from "~/db/schema";
import { handleAccountAction, likeTerm } from "~/lib/admin.server";
import { requireAdmin } from "~/lib/auth.server";
import { LicenseError, reviewLicense } from "~/lib/business.server";
import { today } from "~/lib/dates";
import { date } from "~/lib/format";
import { cn, isUuid, str } from "~/lib/utils";
import type { Route } from "./+types/admin.merchants";

export const meta: Route.MetaFunction = () => [{ title: "Merchants · Admin · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const filter = storeStatus.enumValues.includes(status as StoreStatus) ? (status as StoreStatus) : null;
  const q = url.searchParams.get("q")?.trim() ?? "";
  const { stores, users, products, orders } = schema;

  const merchants = await db
    .select({
      storeId: stores.id,
      registrationNumber: stores.registrationNumber,
      storeName: stores.name,
      slug: stores.slug,
      logoUrl: stores.logoUrl,
      description: stores.description,
      storeStatus: stores.status,
      reviewNote: stores.reviewNote,
      appliedAt: stores.createdAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      userStatus: users.status,
      productCount: sql<number>`(select count(*) from ${products} where ${qualified(products.storeId)} = ${qualified(stores.id)})::int`,
      orderCount: sql<number>`(select count(*) from ${orders} where ${qualified(orders.storeId)} = ${qualified(stores.id)})::int`,
    })
    .from(stores)
    .innerJoin(users, eq(users.id, stores.ownerId))
    .where(
      and(
        filter ? eq(stores.status, filter) : undefined,
        q ? or(ilike(stores.name, likeTerm(q)), ilike(users.name, likeTerm(q)), ilike(users.email, likeTerm(q))) : undefined,
      ),
    )
    // Pending applications first, oldest first so nobody waits too long
    .orderBy(sql`${stores.status} = 'pending' desc`, desc(stores.createdAt))
    .limit(100);

  const licenses = merchants.length
    ? await db.query.businessLicenses.findMany({
        where: inArray(schema.businessLicenses.storeId, merchants.map((m) => m.storeId)),
        columns: { documentKey: false },
      })
    : [];
  return { merchants, licenses, filter, q, today: today() };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  const form = await request.formData();
  if (form.get("intent") === "license") {
    const id = str(form.get("licenseId"));
    const action = str(form.get("action")) as "verify" | "reject" | "show" | "hide";
    if (!isUuid(id) || !["verify", "reject", "show", "hide"].includes(action)) return { error: "Unknown action." };
    try {
      await reviewLicense(id, action, str(form.get("note")).slice(0, 300));
      return { ok: "Licence updated." };
    } catch (e) {
      if (e instanceof LicenseError) return { error: e.message };
      throw e;
    }
  }
  return handleAccountAction(admin, form);
}

function LicenseList({ licenses, today }: { licenses: Route.ComponentProps["loaderData"]["licenses"]; today: string }) {
  const busy = useNavigation().state !== "idle";
  if (!licenses.length) return <p className="text-xs text-muted-foreground">No licences uploaded.</p>;
  return (
    <ul className="grid gap-2">
      {licenses.map((l) => {
        const expired = !!l.expiresOn && l.expiresOn < today;
        return (
          <li key={l.id} className="grid gap-1 rounded-lg border p-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/files/license/${l.id}`} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">{l.name}</a>
              {l.kind === "primary" ? <Badge variant="accent">Primary</Badge> : null}
              <Badge variant={expired ? "destructive" : l.status === "verified" ? "success" : l.status === "rejected" ? "muted" : "warning"} className="capitalize">
                {expired ? "Expired" : l.status}
              </Badge>
              {l.showToCustomers ? <Badge variant="outline">Shown to customers</Badge> : null}
            </div>
            <p className="text-muted-foreground">
              {[l.number && `No. ${l.number}`, l.issuer, l.issuedOn && `issued ${l.issuedOn}`, l.expiresOn && `expires ${l.expiresOn}`].filter(Boolean).join(" · ")}
            </p>
            <Form method="post" className="flex flex-wrap gap-1">
              <input type="hidden" name="intent" value="license" />
              <input type="hidden" name="licenseId" value={l.id} />
              <Input name="note" placeholder="Note" className="h-7 w-40 text-xs" />
              {l.status !== "verified" ? <Button type="submit" name="action" value="verify" size="sm" variant="accent" disabled={busy}>Verify</Button> : null}
              {l.status !== "rejected" ? <Button type="submit" name="action" value="reject" size="sm" variant="ghost" disabled={busy}>Reject</Button> : null}
              {l.status === "verified" ? (
                <Button type="submit" name="action" value={l.showToCustomers ? "hide" : "show"} size="sm" variant="outline" disabled={busy}>
                  {l.showToCustomers ? "Hide from customers" : "Show to customers"}
                </Button>
              ) : null}
            </Form>
          </li>
        );
      })}
    </ul>
  );
}

export default function AdminMerchants({ loaderData, actionData }: Route.ComponentProps) {
  const { merchants, licenses, filter, q } = loaderData;
  const [params] = useSearchParams();
  const tabs: (StoreStatus | null)[] = [null, "pending", "approved", "suspended", "rejected"];
  const tabHref = (t: StoreStatus | null) => {
    const p = new URLSearchParams(params);
    if (t) p.set("status", t);
    else p.delete("status");
    return `?${p}`;
  };

  return (
    <>
      <PageHeader title="Merchants" description="Approve new stores, verify their business documents, and step in when a store breaks the rules." />
      {actionData && "ok" in actionData && actionData.ok ? <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}
      {actionData && "error" in actionData && actionData.error ? <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{actionData.error}</p> : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="scrollbar-none flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
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
          <Input name="q" type="search" defaultValue={q} placeholder="Search store, name or email" className="h-9" />
        </Form>
      </div>

      {merchants.length === 0 ? (
        <EmptyState icon={StoreIcon} title="No merchants here">
          {filter === "pending" ? "No stores are waiting for approval." : "Try another filter or search."}
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {merchants.map((m) => (
            <Card key={m.storeId}>
              <CardContent className="grid gap-4 pt-5 md:grid-cols-[4rem_1fr_auto]">
                <SafeImage src={m.logoUrl} alt="" className="size-16 rounded-xl border" />
                <div className="grid content-start gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/admin/users/${m.userId}`} className="text-lg font-bold hover:text-primary">
                      {m.storeName}
                    </Link>
                    <StoreStatusBadge status={m.storeStatus} />
                    {m.userStatus === "suspended" && m.storeStatus !== "suspended" ? <Badge variant="destructive">Account suspended</Badge> : null}
                  </div>
                  <p className="text-sm">
                    {m.name} · <a href={`mailto:${m.email}`} className="text-accent hover:underline">{m.email}</a>
                    {m.phone ? ` · ${m.phone}` : ""}
                  </p>
                  {m.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{m.description}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    Applied {date(m.appliedAt)} · {m.productCount} products · {m.orderCount} orders
                  </p>
                  {m.reviewNote ? <p className="text-xs text-muted-foreground">Note: {m.reviewNote}</p> : null}
                  <p className="text-sm">
                    Registration number: <strong>{m.registrationNumber ?? "not given"}</strong>
                  </p>
                  <LicenseList licenses={licenses.filter((l) => l.storeId === m.storeId)} today={loaderData.today} />
                  <div className="flex gap-3 text-sm">
                    <Link to={`/admin/users/${m.userId}`} className="font-semibold text-primary hover:underline">Details</Link>
                    <Link to={`/s/${m.slug}`} className="flex items-center gap-1 font-semibold text-accent hover:underline">
                      View store <ExternalLinkIcon className="size-3.5" />
                    </Link>
                  </div>
                </div>
                <AccountActions userId={m.userId} userStatus={m.userStatus} storeStatus={m.storeStatus} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
