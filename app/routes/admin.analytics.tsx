import { Form, Link, useNavigation } from "react-router";
import { FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input } from "~/components/ui/input";
import { adStats, dailyTotals, frequentVisitors, getAnalyticsSettings, monthlyTotals, saveAnalyticsSettings, topProducts, topStores } from "~/lib/analytics.server";
import { requireAdmin } from "~/lib/auth.server";
import { formatDay } from "~/lib/dates";
import { timeAgo } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/admin.analytics";

export const meta: Route.MetaFunction = () => [{ title: "Analytics · Admin · MyPlug" }];

const RANGES = [7, 30, 90] as const;

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const r = Number(new URL(request.url).searchParams.get("days"));
  const days = (RANGES as readonly number[]).includes(r) ? r : 30;
  const [daily, stores, products, ads, visitors, months, settings] = await Promise.all([
    dailyTotals(days),
    topStores(days),
    topProducts(days),
    adStats(days),
    frequentVisitors(),
    monthlyTotals(),
    getAnalyticsSettings(),
  ]);
  return { days, daily, stores, products, ads, visitors, months, settings };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  await saveAnalyticsSettings({
    enabled: form.get("enabled") === "on",
    dailyDays: Number(form.get("dailyDays")),
    visitorMonths: Number(form.get("visitorMonths")),
    monthlyMonths: Number(form.get("monthlyMonths")),
  });
  return { ok: "Analytics settings saved." };
}

const n = (v: number) => v.toLocaleString("en-US");

export default function AdminAnalytics({ loaderData, actionData }: Route.ComponentProps) {
  const { days, daily, stores, products, ads, visitors, months, settings } = loaderData;
  const busy = useNavigation().state !== "idle";
  const totalViews = daily.reduce((s, d) => s + d.pageviews, 0);
  const totalVisitors = daily.reduce((s, d) => s + d.visitors, 0);
  const peak = Math.max(1, ...daily.map((d) => d.pageviews));
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Analytics"
        description="Visitors, the stores they frequent, and how banner ads perform. Counted in the background, after pages load, so the site stays fast."
        actions={
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Link key={r} to={`?days=${r}`} className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", days === r ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70")}>
                {r} days
              </Link>
            ))}
          </div>
        }
      />
      <FormError error={actionData && "error" in actionData ? (actionData.error as string) : null} />
      {actionData && "ok" in actionData ? <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}
      {!settings.enabled ? <p className="rounded-lg bg-warning/20 px-3 py-2 text-sm">Analytics is switched off: nothing new is being recorded.</p> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Page views", totalViews],
          ["Visitors (daily, added up)", totalVisitors],
          ["Pages per visitor", totalVisitors ? Math.round((totalViews / totalVisitors) * 10) / 10 : 0],
          ["Ad clicks", ads.reduce((s, a) => s + a.clicks, 0)],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-extrabold">{n(value as number)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Page views per day</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-40 items-end gap-0.5" role="img" aria-label={`Page views over the last ${days} days`}>
            {daily.map((d) => (
              <div key={d.day} className="group relative flex-1">
                <div className="rounded-t bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${(d.pageviews / peak) * 152 + 2}px` }} />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background group-hover:block">
                  {formatDay(d.day)}: {n(d.pageviews)} views, {n(d.visitors)} visitors
                </span>
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>{formatDay(daily[0].day)}</span>
            <span>{formatDay(daily[daily.length - 1].day)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Most visited stores</CardTitle>
          </CardHeader>
          <CardContent>
            {stores.length ? (
              <ol className="grid gap-1 text-sm">
                {stores.map((s, i) => (
                  <li key={s.subject} className="flex justify-between gap-2">
                    <Link to={`/s/${s.store!.slug}`} className="truncate hover:underline">
                      {i + 1}. {s.store!.name}
                    </Link>
                    <span className="font-semibold">{n(s.count)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">No store visits recorded yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Most viewed listings</CardTitle>
          </CardHeader>
          <CardContent>
            {products.length ? (
              <ol className="grid gap-1 text-sm">
                {products.map((p, i) => (
                  <li key={p.subject} className="flex justify-between gap-2">
                    <Link to={`/p/${p.product!.id}`} className="truncate hover:underline">
                      {i + 1}. {p.product!.title}
                    </Link>
                    <span className="font-semibold">{n(p.count)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">No listing views recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Banner ads</CardTitle>
          <p className="text-sm text-muted-foreground">A view counts when at least half the banner is on screen for a second. Time on screen is the average per view.</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {ads.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Ad</th>
                  <th className="py-1 pr-3">Spot</th>
                  <th className="py-1 pr-3 text-right">Views</th>
                  <th className="py-1 pr-3 text-right">Avg. time</th>
                  <th className="py-1 pr-3 text-right">Clicks</th>
                  <th className="py-1 text-right">Click rate</th>
                </tr>
              </thead>
              <tbody>
                {ads.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="py-1.5 pr-3">
                      <Link to={`/admin/banners/${a.id}`} className="hover:underline">
                        {a.title}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{a.advertiserName}</span>
                    </td>
                    <td className="py-1.5 pr-3">{a.placementKey.replace("_", " ")}</td>
                    <td className="py-1.5 pr-3 text-right">{n(a.views)}</td>
                    <td className="py-1.5 pr-3 text-right">{a.avgSeconds}s</td>
                    <td className="py-1.5 pr-3 text-right">{n(a.clicks)}</td>
                    <td className="py-1.5 text-right">{a.ctr}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No ad views recorded in this period.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customers who visit stores most (this month)</CardTitle>
          <p className="text-sm text-muted-foreground">Signed-in visitors only. Visitors who aren't signed in are counted, but not named. Only admins see this.</p>
        </CardHeader>
        <CardContent>
          {visitors.length ? (
            <div className="grid gap-2">
              {visitors.map((v) =>
                v.user ? (
                  <div key={v.user.id} className="grid gap-0.5 rounded-xl border p-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link to={`/admin/users/${v.user.id}`} className="font-semibold hover:underline">
                        {v.user.name}
                      </Link>
                      <span className="text-muted-foreground">{n(v.total)} store visits · last seen {timeAgo(v.lastSeenAt)}</span>
                    </p>
                    <p className="text-muted-foreground">
                      {v.stores
                        .filter((s) => s.store)
                        .map((s) => `${s.store!.name} (${s.visits})`)
                        .join(" · ")}
                    </p>
                  </div>
                ) : null,
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No signed-in store visits this month yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly summary</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {months.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Month</th>
                  <th className="py-1 pr-3 text-right">Page views</th>
                  <th className="py-1 pr-3 text-right">Visitors</th>
                  <th className="py-1 pr-3 text-right">Store visits</th>
                  <th className="py-1 pr-3 text-right">Ad views</th>
                  <th className="py-1 text-right">Ad clicks</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month} className="border-t">
                    <td className="py-1.5 pr-3">{new Date(`${m.month}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</td>
                    <td className="py-1.5 pr-3 text-right">{n(m.pageviews)}</td>
                    <td className="py-1.5 pr-3 text-right">{n(m.visitors)}</td>
                    <td className="py-1.5 pr-3 text-right">{n(m.storeViews)}</td>
                    <td className="py-1.5 pr-3 text-right">{n(m.adViews)}</td>
                    <td className="py-1.5 text-right">{n(m.adClicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settings and retention</CardTitle>
          <p className="text-sm text-muted-foreground">
            Recording happens in a small background request after each page has loaded (batched, at most three tiny database writes), never
            while a page is being built. Bots and people with "Do Not Track" switched on aren't counted. The daily job rolls day-by-day detail into
            monthly totals and deletes what's past these periods.
          </p>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4 sm:grid-cols-3">
            <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-3">
              <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="size-4 accent-primary" />
              Record analytics
            </label>
            <Field label="Keep day-by-day detail (days)" hint="Then rolled into monthly totals">
              <Input name="dailyDays" type="number" min={7} max={730} defaultValue={settings.dailyDays} />
            </Field>
            <Field label="Keep who-visits-which-store (months)">
              <Input name="visitorMonths" type="number" min={1} max={60} defaultValue={settings.visitorMonths} />
            </Field>
            <Field label="Keep monthly totals (months)">
              <Input name="monthlyMonths" type="number" min={1} max={120} defaultValue={settings.monthlyMonths} />
            </Field>
            <Button type="submit" disabled={busy} className="justify-self-start">
              Save
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
