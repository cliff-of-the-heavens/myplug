import { desc, eq, sql } from "drizzle-orm";
import { BellRingIcon } from "lucide-react";
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { AlertFields } from "~/components/alert-composer";
import { FormError, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, NativeSelect } from "~/components/ui/input";
import { SafeImage } from "~/components/safe-image";
import { db, schema } from "~/db/client.server";
import { qualified } from "~/db/sql";
import { alertType as alertTypeEnum, type AlertType } from "~/db/schema";
import { ALERT_NAME, ALERT_TYPE_LABEL, ALERT_TYPES, MAX_ALERT_ITEMS } from "~/lib/alerts";
import { AlertError, getAlertSettings, getQuota, sendAlert, subscriberCounts } from "~/lib/alerts.server";
import { requireMerchant } from "~/lib/auth.server";
import { timeAgo } from "~/lib/format";
import { capitalize, cn, str } from "~/lib/utils";
import type { Route } from "./+types/sell.alerts";

export const meta: Route.MetaFunction = () => [{ title: "Email alerts · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const { stockAlerts, stockAlertItems, alertDeliveries, products } = schema;
  const [quota, counts, settings, myProducts, history] = await Promise.all([
    getQuota(user.storeId),
    subscriberCounts(user.storeId),
    getAlertSettings(),
    db.query.products.findMany({
      where: (p, { and, eq }) => and(eq(p.storeId, user.storeId), eq(p.isActive, true)),
      columns: { id: true, title: true, imageUrl: true, imageHidden: true },
      orderBy: desc(products.createdAt),
    }),
    db
      .select({
        id: stockAlerts.id,
        type: stockAlerts.type,
        message: stockAlerts.message,
        createdAt: stockAlerts.createdAt,
        recipients: stockAlerts.recipientCount,
        // Counts only: the store never sees who received it
        sent: sql<number>`(select count(*) from ${alertDeliveries} where ${qualified(alertDeliveries.alertId)} = ${qualified(stockAlerts.id)} and ${qualified(alertDeliveries.status)} = 'sent')::int`,
        titles: sql<string>`(select string_agg(${qualified(products.title)}, ', ' order by ${qualified(stockAlertItems.position)})
          from ${stockAlertItems} join ${products} on ${qualified(products.id)} = ${qualified(stockAlertItems.productId)}
          where ${qualified(stockAlertItems.alertId)} = ${qualified(stockAlerts.id)})`,
      })
      .from(stockAlerts)
      .where(eq(stockAlerts.storeId, user.storeId))
      .orderBy(desc(stockAlerts.createdAt))
      .limit(30),
  ]);
  return { quota, counts, settings, products: myProducts, history };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireMerchant(request);
  const form = await request.formData();
  const type = str(form.get("alertType")) as AlertType;
  if (!alertTypeEnum.enumValues.includes(type)) return { error: "Choose an alert." };
  try {
    const alert = await sendAlert({
      storeId: user.storeId,
      productIds: form.getAll("productId").map(String),
      type,
      message: str(form.get("alertMessage")),
      userId: user.id,
    });
    return { ok: `${capitalize(ALERT_NAME[type])} alert sent to ${alert.recipientCount} subscriber${alert.recipientCount === 1 ? "" : "s"}.` };
  } catch (e) {
    if (e instanceof AlertError) return { error: e.message };
    throw e;
  }
}

export default function SellAlerts({ loaderData, actionData }: Route.ComponentProps) {
  const { quota, counts, settings, products, history } = loaderData;
  const busy = useNavigation().state !== "idle";
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length < MAX_ALERT_ITEMS ? [...list, id] : list));

  return (
    <>
      <PageHeader
        title="Email alerts"
        description="Let customers who follow your store know about new arrivals, restocks and discounts. MyPlug sends the emails for you."
      />
      {actionData && "ok" in actionData ? (
        <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p>
      ) : null}
      <div className="mb-4">
        <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Subscribers</p>
          <p className="text-2xl font-black">{counts.total}</p>
        </Card>
        {ALERT_TYPES.map((t) => (
          <Card key={t.type} className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Want {t.label.toLowerCase()}</p>
            <p className="text-2xl font-black">{counts[t.type]}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Send an alert</CardTitle>
          </CardHeader>
          <CardContent>
            {products.length ? (
              <Form method="post" className="grid gap-4">
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-semibold">
                    Products to feature <span className="font-normal text-muted-foreground">({picked.length}/{MAX_ALERT_ITEMS})</span>
                  </legend>
                  <div className="grid max-h-72 gap-1 overflow-y-auto rounded-xl border p-1">
                    {products.map((p) => {
                      const on = picked.includes(p.id);
                      return (
                        <label
                          key={p.id}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-lg p-1.5 text-sm",
                            on ? "bg-primary/10" : "hover:bg-muted",
                            !on && picked.length >= MAX_ALERT_ITEMS && "opacity-50",
                          )}
                        >
                          <input type="checkbox" name="productId" value={p.id} checked={on} onChange={() => toggle(p.id)} className="size-4 accent-primary" />
                          <SafeImage src={p.imageUrl} hidden={p.imageHidden} alt="" className="size-9 shrink-0 rounded-md" />
                          <span className="truncate">{p.title}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The email shows each product with a link, plus a button to see everything in your store.
                  </p>
                </fieldset>
                <AlertFields quota={quota} counts={counts} optional={false} />
                <Button type="submit" disabled={busy || !picked.length || quota.remaining <= 0 || quota.blocked || !quota.enabled} className="justify-self-start">
                  <BellRingIcon /> {busy ? "Sending..." : "Send alert"}
                </Button>
              </Form>
            ) : (
              <p className="text-sm text-muted-foreground">Add a product first.</p>
            )}
          </CardContent>
        </Card>
        <Card className="content-start">
          <CardHeader>
            <CardTitle>The rules</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground">
            <p>Up to <strong className="text-foreground">{settings.weeklyLimit} alerts</strong> every 7 days.</p>
            <p>One new-arrival alert per product, and the same alert for a product at most every {settings.cooldownDays} days.</p>
            <p>Restock alerts need the product in stock. Discount alerts need at least {settings.minDiscountPct}% off (set the "Was" price).</p>
            <p>Only customers who chose that type of alert get it, and they can unsubscribe from any email.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Sent alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length ? (
            <ul className="divide-y text-sm">
              {history.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                  <Badge variant="secondary">{ALERT_TYPE_LABEL[a.type]}</Badge>
                  <span className="font-semibold">{a.titles}</span>
                  {a.message ? <span className="truncate text-muted-foreground">“{a.message}”</span> : null}
                  <span className="ml-auto text-muted-foreground">
                    {a.sent} of {a.recipients} delivered · {timeAgo(a.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No alerts sent yet.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
