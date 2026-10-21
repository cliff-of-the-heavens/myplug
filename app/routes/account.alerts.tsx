import { desc, eq } from "drizzle-orm";
import { BellIcon, BellOffIcon } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import { Container, EmptyState, PageHeader } from "~/components/page";
import { SafeImage } from "~/components/safe-image";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { ALERT_TYPES } from "~/lib/alerts";
import { setEmailAlerts, setSubscription, unsubscribeStore } from "~/lib/alerts.server";
import { requireCustomer } from "~/lib/auth.server";
import { cn, isUuid, str } from "~/lib/utils";
import type { Route } from "./+types/account.alerts";

export const meta: Route.MetaFunction = () => [{ title: "Email alerts · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  const [me, subscriptions] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, user.id), columns: { emailAlerts: true, email: true } }),
    db.query.storeSubscriptions.findMany({
      where: eq(schema.storeSubscriptions.userId, user.id),
      orderBy: desc(schema.storeSubscriptions.createdAt),
      with: { store: { columns: { id: true, name: true, slug: true, logoUrl: true } } },
    }),
  ]);
  return { emailAlerts: me!.emailAlerts, email: me!.email, subscriptions };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const storeId = str(form.get("storeId"));
  if ((intent === "unfollow" || intent === "save") && !isUuid(storeId)) return { ok: false };
  if (intent === "all-on" || intent === "all-off") {
    await setEmailAlerts(user.id, intent === "all-on");
  } else if (intent === "unfollow") {
    await unsubscribeStore(user.id, storeId);
  } else if (intent === "save") {
    await setSubscription(user.id, storeId, {
      newProducts: form.get("newProducts") === "on",
      restocks: form.get("restocks") === "on",
      discounts: form.get("discounts") === "on",
    });
  }
  return { ok: true };
}

export default function AccountAlerts({ loaderData }: Route.ComponentProps) {
  const { emailAlerts, email, subscriptions } = loaderData;
  const busy = useNavigation().state !== "idle";

  return (
    <Container className="max-w-3xl py-8">
      <PageHeader
        title="Email alerts"
        description="Choose which stores can let you know about new arrivals, restocks and discounts."
      />

      <Card className={cn("mb-6", !emailAlerts && "border-warning")}>
        <CardContent className="flex flex-wrap items-center gap-4 pt-5">
          <span className={cn("flex size-12 items-center justify-center rounded-full", emailAlerts ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
            {emailAlerts ? <BellIcon /> : <BellOffIcon />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">{emailAlerts ? "Alerts are on" : "All alerts are off"}</p>
            <p className="text-sm text-muted-foreground">
              {emailAlerts
                ? `Sent to ${email}. Stores never see your email address.`
                : "You won't get any alert emails, whatever you follow below."}
            </p>
          </div>
          <Form method="post">
            <Button type="submit" name="intent" value={emailAlerts ? "all-off" : "all-on"} variant={emailAlerts ? "outline" : "default"} disabled={busy}>
              {emailAlerts ? "Turn off all alerts" : "Turn alerts back on"}
            </Button>
          </Form>
        </CardContent>
      </Card>

      {subscriptions.length === 0 ? (
        <EmptyState icon={BellIcon} title="You're not following any stores">
          Tap <strong>Get alerts</strong> on a store or product page to hear about new stock and discounts.{" "}
          <Link to="/search" className="font-semibold text-primary">Browse stores</Link>
        </EmptyState>
      ) : (
        <ul className={cn("grid gap-3", !emailAlerts && "opacity-60")}>
          {subscriptions.map((s) => (
            <li key={s.id}>
              <Card>
                <CardContent className="pt-5">
                  <Form method="post" className="grid gap-3">
                    <input type="hidden" name="storeId" value={s.store.id} />
                    <div className="flex items-center gap-3">
                      <SafeImage src={s.store.logoUrl} alt="" className="size-10 rounded-lg border" />
                      <Link to={`/s/${s.store.slug}`} className="font-bold hover:text-primary">{s.store.name}</Link>
                      <Button type="submit" name="intent" value="unfollow" variant="ghost" size="sm" className="ml-auto" disabled={busy}>
                        Unsubscribe
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {ALERT_TYPES.map((t) => (
                        <label
                          key={t.type}
                          className="flex cursor-pointer items-center gap-2 rounded-full border-2 px-3 py-1 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                        >
                          <input type="checkbox" name={t.field} defaultChecked={s[t.field]} className="size-4 accent-primary" />
                          {t.label}
                        </label>
                      ))}
                      <Button type="submit" name="intent" value="save" size="sm" disabled={busy}>
                        Save
                      </Button>
                    </div>
                  </Form>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
