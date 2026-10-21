import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { BanIcon, BikeIcon, CheckIcon, FileTextIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { EmptyState, FormError, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { qualified } from "~/db/sql";
import { likeTerm } from "~/lib/admin.server";
import { requireAdmin } from "~/lib/auth.server";
import { CourierError, reviewCourier } from "~/lib/couriers.server";
import { date, money } from "~/lib/format";
import { cn, isUuid, str } from "~/lib/utils";
import type { Route } from "./+types/admin.couriers";

export const meta: Route.MetaFunction = () => [{ title: "Couriers · Admin · MyPlug" }];

const STATUSES = ["pending", "approved", "rejected", "suspended"] as const;
const TONE = { pending: "warning", approved: "success", rejected: "muted", suspended: "destructive" } as const;

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const filter = STATUSES.includes(status as (typeof STATUSES)[number]) ? (status as (typeof STATUSES)[number]) : null;
  const q = url.searchParams.get("q")?.trim() ?? "";
  const { couriers, users, deliveries } = schema;
  const list = await db
    .select({
      id: couriers.id,
      name: couriers.name,
      phone: couriers.phone,
      vehicle: couriers.vehicle,
      plateNumber: couriers.plateNumber,
      nationalIdNumber: couriers.nationalIdNumber,
      hasFace: sql<boolean>`${couriers.facePhotoKey} is not null`,
      hasId: sql<boolean>`${couriers.idDocumentKey} is not null`,
      status: couriers.status,
      reviewNote: couriers.reviewNote,
      createdAt: couriers.createdAt,
      email: users.email,
      delivered: sql<number>`(select count(*) from ${deliveries} where ${qualified(deliveries.courierId)} = ${qualified(couriers.id)} and ${qualified(deliveries.status)} = 'delivered')::int`,
    })
    .from(couriers)
    .innerJoin(users, eq(users.id, couriers.userId))
    .where(and(filter ? eq(couriers.status, filter) : undefined, q ? or(ilike(couriers.name, likeTerm(q)), ilike(couriers.phone, likeTerm(q)), ilike(users.email, likeTerm(q))) : undefined))
    .orderBy(sql`${couriers.status} = 'pending' desc`, desc(couriers.createdAt))
    .limit(100);
  const rates = await db.query.courierRates.findMany({ columns: { courierId: true, area: true, estimateCents: true } });
  return { list, rates, filter, q };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const id = str(form.get("courierId"));
  const act = str(form.get("action")) as "approve" | "reject" | "suspend" | "reactivate";
  if (!isUuid(id) || !["approve", "reject", "suspend", "reactivate"].includes(act)) return { error: "Unknown action." };
  try {
    await reviewCourier(id, act, str(form.get("note")).slice(0, 500));
    return { ok: "Saved and the courier has been told." };
  } catch (e) {
    if (e instanceof CourierError) return { error: e.message };
    throw e;
  }
}

export default function AdminCouriers({ loaderData, actionData }: Route.ComponentProps) {
  const { list, rates, filter, q } = loaderData;
  const [params] = useSearchParams();
  const busy = useNavigation().state !== "idle";
  const tabHref = (t: string | null) => {
    const p = new URLSearchParams(params);
    if (t) p.set("status", t);
    else p.delete("status");
    return `?${p}`;
  };

  return (
    <>
      <PageHeader title="Couriers" description="Check each courier's face photo against their ID before approving them." />
      {actionData && "ok" in actionData ? <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      <div className="my-4 flex flex-wrap items-center gap-2">
        {[null, ...STATUSES].map((t) => (
          <Link key={t ?? "all"} to={tabHref(t)} className={cn("rounded-full px-3 py-1 text-sm font-semibold capitalize", filter === t ? "bg-foreground text-background" : "bg-muted")}>
            {t ?? "All"}
          </Link>
        ))}
        <Form className="ml-auto w-full sm:w-64">
          {filter ? <input type="hidden" name="status" value={filter} /> : null}
          <Input name="q" type="search" defaultValue={q} placeholder="Name, phone or email" className="h-9" />
        </Form>
      </div>

      {list.length === 0 ? (
        <EmptyState icon={BikeIcon} title="No couriers here" />
      ) : (
        <div className="grid gap-3">
          {list.map((c) => (
            <Card key={c.id}>
              <CardContent className="grid gap-4 pt-5 md:grid-cols-[7rem_1fr_auto]">
                {c.hasFace ? (
                  <a href={`/files/courier/${c.id}?which=face`} target="_blank" rel="noreferrer">
                    <img src={`/files/courier/${c.id}?which=face`} alt="" className="aspect-square w-28 rounded-xl border object-cover" />
                  </a>
                ) : (
                  <div className="grid aspect-square w-28 place-items-center rounded-xl bg-muted text-center text-xs text-muted-foreground">No photo</div>
                )}
                <div className="grid content-start gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold">{c.name}</span>
                    <Badge variant={TONE[c.status]} className="capitalize">{c.status}</Badge>
                  </div>
                  <p>{c.phone} · {c.email}</p>
                  <p className="text-muted-foreground">
                    ID {c.nationalIdNumber ?? "not given"} · {c.vehicle ?? "no vehicle given"} {c.plateNumber ? `(${c.plateNumber})` : ""} · joined {date(c.createdAt)} · {c.delivered} deliveries
                  </p>
                  {c.hasId ? (
                    <a href={`/files/courier/${c.id}?which=id`} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1 font-semibold text-accent hover:underline">
                      <FileTextIcon className="size-4" /> Open ID document
                    </a>
                  ) : (
                    <p className="text-destructive">No ID document uploaded</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Areas: {rates.filter((r) => r.courierId === c.id).map((r) => `${r.area} (${money(r.estimateCents)})`).join(", ") || "none yet"}
                  </p>
                  {c.reviewNote ? <p className="text-xs">Note: {c.reviewNote}</p> : null}
                </div>
                <Form method="post" className="grid content-start gap-2 md:w-52">
                  <input type="hidden" name="courierId" value={c.id} />
                  <Input name="note" placeholder="Note (reason)" className="h-8" />
                  {c.status === "pending" || c.status === "rejected" ? (
                    <Button type="submit" name="action" value="approve" size="sm" variant="accent" disabled={busy}><CheckIcon /> Approve</Button>
                  ) : null}
                  {c.status === "pending" ? (
                    <Button type="submit" name="action" value="reject" size="sm" variant="outline" disabled={busy}><XIcon /> Reject</Button>
                  ) : null}
                  {c.status === "approved" ? (
                    <Button type="submit" name="action" value="suspend" size="sm" variant="destructive" disabled={busy}><BanIcon /> Suspend</Button>
                  ) : null}
                  {c.status === "suspended" ? (
                    <Button type="submit" name="action" value="reactivate" size="sm" variant="secondary" disabled={busy}><RotateCcwIcon /> Reactivate</Button>
                  ) : null}
                </Form>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
