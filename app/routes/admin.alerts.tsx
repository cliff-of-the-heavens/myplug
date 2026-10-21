import { desc, eq, gt, sql } from "drizzle-orm";
import { BanIcon, EyeIcon, MailWarningIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import { FormError, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { qualified } from "~/db/sql";
import { ALERT_TYPE_LABEL } from "~/lib/alerts";
import { getAlertSettings, processAlertQueue, saveAlertSettings } from "~/lib/alerts.server";
import { requireAdmin } from "~/lib/auth.server";
import { EMAIL_PROVIDER_CONFIGURED } from "~/lib/email.server";
import { timeAgo } from "~/lib/format";
import { isUuid, str } from "~/lib/utils";
import type { Route } from "./+types/admin.alerts";

export const meta: Route.MetaFunction = () => [{ title: "Email alerts · Admin · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const { stockAlerts, stockAlertItems, alertDeliveries, storeSubscriptions, stores, products } = schema;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [settings, [queue], [subs], storeRows, recent] = await Promise.all([
    getAlertSettings(),
    db
      .select({
        pending: sql<number>`count(*) filter (where ${alertDeliveries.status} in ('pending','sending'))::int`,
        sentWeek: sql<number>`count(*) filter (where ${alertDeliveries.status} = 'sent' and ${alertDeliveries.sentAt} > ${weekAgo})::int`,
        failed: sql<number>`count(*) filter (where ${alertDeliveries.status} = 'failed')::int`,
      })
      .from(alertDeliveries),
    db.select({ n: sql<number>`count(*)::int` }).from(storeSubscriptions),
    db
      .select({
        id: stores.id,
        name: stores.name,
        ownerId: stores.ownerId,
        alertsBlocked: stores.alertsBlocked,
        subscribers: sql<number>`(select count(*) from ${storeSubscriptions} where ${qualified(storeSubscriptions.storeId)} = ${qualified(stores.id)})::int`,
        alertsWeek: sql<number>`(select count(*) from ${stockAlerts} where ${qualified(stockAlerts.storeId)} = ${qualified(stores.id)} and ${qualified(stockAlerts.createdAt)} > ${weekAgo})::int`,
      })
      .from(stores)
      .where(eq(stores.status, "approved"))
      .orderBy(stores.name)
      .limit(100),
    db
      .select({
        id: stockAlerts.id,
        type: stockAlerts.type,
        message: stockAlerts.message,
        createdAt: stockAlerts.createdAt,
        recipients: stockAlerts.recipientCount,
        storeName: stores.name,
        titles: sql<string>`(select string_agg(${qualified(products.title)}, ', ' order by ${qualified(stockAlertItems.position)})
          from ${stockAlertItems} join ${products} on ${qualified(products.id)} = ${qualified(stockAlertItems.productId)}
          where ${qualified(stockAlertItems.alertId)} = ${qualified(stockAlerts.id)})`,
        sent: sql<number>`(select count(*) from ${alertDeliveries} where ${qualified(alertDeliveries.alertId)} = ${qualified(stockAlerts.id)} and ${qualified(alertDeliveries.status)} = 'sent')::int`,
        skipped: sql<number>`(select count(*) from ${alertDeliveries} where ${qualified(alertDeliveries.alertId)} = ${qualified(stockAlerts.id)} and ${qualified(alertDeliveries.status)} = 'skipped')::int`,
        failed: sql<number>`(select count(*) from ${alertDeliveries} where ${qualified(alertDeliveries.alertId)} = ${qualified(stockAlerts.id)} and ${qualified(alertDeliveries.status)} = 'failed')::int`,
      })
      .from(stockAlerts)
      .innerJoin(stores, eq(stores.id, stockAlerts.storeId))
      .where(gt(stockAlerts.createdAt, new Date(Date.now() - 30 * 86_400_000)))
      .orderBy(desc(stockAlerts.createdAt))
      .limit(50),
  ]);

  return { settings, queue, subscriptions: subs.n, stores: storeRows, recent, providerConfigured: EMAIL_PROVIDER_CONFIGURED };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "settings") {
    const int = (name: string, min: number, max: number) => {
      const n = Math.floor(Number(form.get(name)));
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
    };
    await saveAlertSettings({
      enabled: form.get("enabled") === "on",
      weeklyLimit: int("weeklyLimit", 0, 50),
      cooldownDays: int("cooldownDays", 0, 90),
      minDiscountPct: int("minDiscountPct", 1, 90),
    });
    return { ok: "Alert limits saved." };
  }
  if ((intent === "block" || intent === "unblock") && isUuid(str(form.get("storeId")))) {
    await db
      .update(schema.stores)
      .set({ alertsBlocked: intent === "block" })
      .where(eq(schema.stores.id, str(form.get("storeId"))));
    return { ok: intent === "block" ? "Alerts paused for that store." : "Alerts allowed again for that store." };
  }
  if (intent === "process") {
    const r = await processAlertQueue(100);
    return { ok: `Sent ${r.sent}, skipped ${r.skipped} (opted out), failed ${r.failed}.` };
  }
  return { error: "Unknown action." };
}

export default function AdminAlerts({ loaderData, actionData }: Route.ComponentProps) {
  const { settings, queue, subscriptions, stores, recent, providerConfigured } = loaderData;
  const busy = useNavigation().state !== "idle";

  return (
    <>
      <PageHeader
        title="Email alerts"
        description="Merchants can email their followers about new stock and discounts. Set the limits here, and pause any store that misuses it."
      />
      {!providerConfigured ? (
        <p className="mb-4 flex gap-2 rounded-lg bg-warning/20 px-3 py-2 text-sm">
          <MailWarningIcon className="size-5 shrink-0" />
          No email provider is configured, so alert emails are only logged on the server. Set RESEND_API_KEY and EMAIL_FROM to send them.
        </p>
      ) : null}
      {actionData && "ok" in actionData ? (
        <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p>
      ) : null}
      <div className="mb-4">
        <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Store follows", subscriptions],
          ["Emails sent (7 days)", queue.sentWeek],
          ["Waiting to send", queue.pending],
          ["Failed", queue.failed],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="text-2xl font-black">{value}</p>
          </Card>
        ))}
      </div>
      {queue.pending ? (
        <Form method="post" className="mt-3">
          <Button type="submit" name="intent" value="process" size="sm" variant="outline" disabled={busy}>
            <PlayIcon /> Send waiting emails now
          </Button>
        </Form>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Limits for merchants</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4 sm:grid-cols-3">
            <input type="hidden" name="intent" value="settings" />
            <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-3">
              <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="size-4 accent-primary" />
              Merchants can send email alerts
            </label>
            <Field label="Alerts per store per 7 days">
              <Input name="weeklyLimit" type="number" min={0} max={50} defaultValue={settings.weeklyLimit} />
            </Field>
            <Field label="Days before the same alert for a product" hint="New-arrival alerts are once per product">
              <Input name="cooldownDays" type="number" min={0} max={90} defaultValue={settings.cooldownDays} />
            </Field>
            <Field label="Minimum discount for discount alerts (%)">
              <Input name="minDiscountPct" type="number" min={1} max={90} defaultValue={settings.minDiscountPct} />
            </Field>
            <Button type="submit" disabled={busy} className="justify-self-start">
              Save limits
            </Button>
          </Form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Stores</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {stores.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                <Link to={`/admin/users/${s.ownerId}`} className="font-semibold hover:text-primary">{s.name}</Link>
                {s.alertsBlocked ? <Badge variant="destructive">Alerts paused</Badge> : null}
                <span className="ml-auto text-muted-foreground">
                  {s.subscribers} followers · {s.alertsWeek}/{settings.weeklyLimit} alerts this week
                </span>
                <Form method="post">
                  <input type="hidden" name="storeId" value={s.id} />
                  {s.alertsBlocked ? (
                    <Button type="submit" name="intent" value="unblock" size="sm" variant="secondary" disabled={busy}>
                      <RotateCcwIcon /> Allow
                    </Button>
                  ) : (
                    <Button type="submit" name="intent" value="block" size="sm" variant="ghost" disabled={busy}>
                      <BanIcon /> Pause alerts
                    </Button>
                  )}
                </Form>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Alerts in the last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length ? (
            <ul className="divide-y text-sm">
              {recent.map((a) => (
                <li key={a.id} className="grid gap-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{ALERT_TYPE_LABEL[a.type]}</Badge>
                    <span className="font-semibold">{a.storeName}</span>
                    <span>{a.titles}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
                  </div>
                  {a.message ? <p className="text-muted-foreground">“{a.message}”</p> : null}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {a.recipients} recipients · {a.sent} sent · {a.skipped} opted out · {a.failed} failed
                    </span>
                    <a href={`/admin/alerts/${a.id}/preview`} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold text-primary hover:underline">
                      <EyeIcon className="size-3.5" /> Preview email
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No alerts sent recently.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
