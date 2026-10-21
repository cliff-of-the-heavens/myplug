import { and, desc, eq, sql } from "drizzle-orm";
import { BanIcon, CheckIcon, EyeIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import { EmptyState, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { reportTarget, type ReportTarget } from "~/db/schema";
import { requireAdmin } from "~/lib/auth.server";
import { timeAgo } from "~/lib/format";
import { describeTarget, resolveReports, type ModerationAction } from "~/lib/moderation.server";
import { REPORT_REASON_LABEL } from "~/lib/moderation";
import { str } from "~/lib/utils";
import type { Route } from "./+types/admin.moderation";

export const meta: Route.MetaFunction = () => [{ title: "Moderation · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const r = schema.reports;

  // One row per reported item, with how many people reported it and why
  const groups = await db
    .select({
      targetType: r.targetType,
      targetId: r.targetId,
      count: sql<number>`count(*)::int`,
      reasons: sql<string[]>`array_agg(distinct ${r.reason})`,
      details: sql<string[]>`array_remove(array_agg(${r.details}), null)`,
      latest: sql<Date>`max(${r.createdAt})`.mapWith((v) => new Date(v)),
    })
    .from(r)
    .where(eq(r.status, "open"))
    .groupBy(r.targetType, r.targetId)
    .orderBy(desc(sql`count(*)`), desc(sql`max(${r.createdAt})`))
    .limit(50);

  const queue = await Promise.all(
    groups.map(async (g) => ({ ...g, target: await describeTarget(g.targetType, g.targetId) })),
  );

  const recent = await db.query.reports.findMany({
    where: and(sql`${r.status} <> 'open'`),
    orderBy: desc(r.reviewedAt),
    limit: 15,
  });

  return { queue, recent };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  const form = await request.formData();
  const targetType = str(form.get("targetType")) as ReportTarget;
  const action = str(form.get("action")) as ModerationAction;
  if (!reportTarget.enumValues.includes(targetType)) return { error: "Bad target" };
  if (!["remove", "restore", "dismiss", "suspend"].includes(action)) return { error: "Bad action" };

  await resolveReports(admin, {
    targetType,
    targetId: str(form.get("targetId")),
    action,
    note: str(form.get("note")),
  });
  return { ok: true };
}

export default function Admin({ loaderData }: Route.ComponentProps) {
  const { queue, recent } = loaderData;
  const nav = useNavigation();

  return (
    <>
      <PageHeader
        title="Moderation"
        description="Reported images and content, most-reported first. Items reported as nudity or by several users are already hidden."
      />

      {queue.length === 0 ? (
        <EmptyState icon={ShieldCheckIcon} title="All clear">
          No open reports right now.
        </EmptyState>
      ) : (
        <div className="grid gap-4">
          {queue.map((item) => {
            const busy = nav.formData?.get("targetId") === item.targetId;
            return (
              <Card key={`${item.targetType}:${item.targetId}`} className={busy ? "opacity-50" : ""}>
                <CardContent className="grid gap-4 pt-5 md:grid-cols-[10rem_1fr_auto]">
                  <div className="relative">
                    {item.target?.imageUrl ? (
                      // Blurred by default so moderators aren't hit with graphic content; hover to reveal.
                      <a href={item.target.imageUrl} target="_blank" rel="noreferrer" className="group block">
                        <img
                          src={item.target.imageUrl}
                          alt=""
                          className="aspect-square w-full rounded-xl object-cover blur-xl transition group-hover:blur-none"
                        />
                        <EyeIcon className="absolute inset-0 m-auto size-6 text-white drop-shadow group-hover:hidden" />
                      </a>
                    ) : (
                      <div className="grid aspect-square place-items-center rounded-xl bg-muted text-xs text-muted-foreground">
                        No image
                      </div>
                    )}
                  </div>

                  <div className="grid content-start gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{item.targetType}</Badge>
                      <Badge variant="destructive">{item.count} report{item.count > 1 ? "s" : ""}</Badge>
                      {item.target?.hidden ? <Badge variant="muted">Currently hidden</Badge> : null}
                      <span className="text-xs text-muted-foreground">latest {timeAgo(item.latest)}</span>
                    </div>
                    {item.target ? (
                      <>
                        <p className="font-bold">
                          {item.target.href ? (
                            <Link to={item.target.href} className="hover:text-primary">{item.target.title}</Link>
                          ) : (
                            item.target.title
                          )}{" "}
                          <span className="text-sm font-normal text-muted-foreground">by {item.target.by}</span>
                        </p>
                        {item.target.text ? <p className="line-clamp-3 text-sm text-muted-foreground">{item.target.text}</p> : null}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">This item no longer exists.</p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {item.reasons.map((r) => (
                        <Badge key={r} variant="warning">{REPORT_REASON_LABEL[r] ?? r}</Badge>
                      ))}
                    </div>
                    {item.details.length ? (
                      <ul className="grid gap-1 text-xs text-muted-foreground">
                        {item.details.slice(0, 3).map((d, i) => (
                          <li key={i}>“{d}”</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <Form method="post" className="grid content-start gap-2 md:w-48">
                    <input type="hidden" name="targetType" value={item.targetType} />
                    <input type="hidden" name="targetId" value={item.targetId} />
                    <Input name="note" placeholder="Note (optional)" className="h-8" />
                    <Button type="submit" name="action" value="remove" variant="destructive" size="sm">
                      <Trash2Icon /> Take down
                    </Button>
                    <Button type="submit" name="action" value="suspend" variant="outline" size="sm">
                      <BanIcon /> Take down + suspend user
                    </Button>
                    <Button type="submit" name="action" value="dismiss" variant="secondary" size="sm">
                      <CheckIcon /> Dismiss & restore
                    </Button>
                  </Form>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {recent.length ? (
        <section className="mt-10">
          <h2 className="mb-3 font-bold">Recently resolved</h2>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-3 px-4 py-2">
                <Badge variant={r.status === "actioned" ? "destructive" : "muted"}>{r.status}</Badge>
                <span>{r.targetType}</span>
                <span className="text-muted-foreground">{REPORT_REASON_LABEL[r.reason] ?? r.reason}</span>
                <span className="text-muted-foreground">{r.resolutionNote}</span>
                <span className="ml-auto text-xs text-muted-foreground">{r.reviewedAt ? timeAgo(r.reviewedAt) : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
