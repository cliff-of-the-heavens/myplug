import { eq } from "drizzle-orm";
import { BellOffIcon, CheckCircle2Icon } from "lucide-react";
import { data, Form, Link, useNavigation } from "react-router";
import { Container } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { setEmailAlerts, unsubscribeStore, verifyUnsubscribe } from "~/lib/alerts.server";
import { isUuid } from "~/lib/utils";
import type { Route } from "./+types/alerts.unsubscribe";

export const meta: Route.MetaFunction = () => [{ title: "Unsubscribe · MyPlug" }, { name: "robots", content: "noindex" }];

/** The signed link from an alert email identifies the customer, so no sign-in is needed. */
async function verified(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("u");
  if (!verifyUnsubscribe(userId, url.searchParams.get("t"))) {
    throw data("This unsubscribe link is invalid. Sign in and open Email alerts in your account instead.", { status: 400 });
  }
  const s = url.searchParams.get("s");
  const storeId = s && isUuid(s) ? s : null;
  const [user, store] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, userId!), columns: { id: true, emailAlerts: true } }),
    storeId ? db.query.stores.findFirst({ where: eq(schema.stores.id, storeId), columns: { id: true, name: true } }) : null,
  ]);
  if (!user) throw data("Account not found.", { status: 404 });
  return { user, store: store ?? null };
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, store } = await verified(request);
  return { store, emailAlerts: user.emailAlerts };
}

export async function action({ request }: Route.ActionArgs) {
  const { user, store } = await verified(request);
  const form = await request.formData();
  // RFC 8058 one-click unsubscribe from the mail app: unsubscribe from what the link was for.
  const oneClick = form.get("List-Unsubscribe") === "One-Click";
  const intent = oneClick ? (store ? "store" : "all") : form.get("intent");

  if (intent === "store" && store) {
    await unsubscribeStore(user.id, store.id);
    return { done: `You won't get any more alerts from ${store.name}.` };
  }
  if (intent === "all") {
    await setEmailAlerts(user.id, false);
    return { done: "You won't get any more alert emails from MyPlug." };
  }
  if (intent === "resubscribe") {
    await setEmailAlerts(user.id, true);
    return { done: "Alerts are back on." };
  }
  return { done: null };
}

export default function Unsubscribe({ loaderData, actionData }: Route.ComponentProps) {
  const { store } = loaderData;
  const busy = useNavigation().state !== "idle";
  const done = actionData?.done;

  return (
    <Container className="grid max-w-lg place-items-center py-12">
      <Card className="w-full">
        <CardContent className="grid justify-items-center gap-4 pt-8 pb-8 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            {done ? <CheckCircle2Icon className="size-7 text-success" /> : <BellOffIcon className="size-7" />}
          </span>
          {done ? (
            <>
              <h1 className="text-xl font-extrabold">{done}</h1>
              <p className="text-sm text-muted-foreground">
                Changed your mind? Manage everything in <Link to="/account/alerts" className="font-semibold text-primary">Email alerts</Link>.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-extrabold">Unsubscribe from alerts</h1>
              <Form method="post" className="grid w-full gap-2">
                {store ? (
                  <Button type="submit" name="intent" value="store" size="lg" disabled={busy}>
                    Stop alerts from {store.name}
                  </Button>
                ) : null}
                <Button type="submit" name="intent" value="all" size="lg" variant={store ? "outline" : "default"} disabled={busy}>
                  Stop all MyPlug alert emails
                </Button>
              </Form>
              <p className="text-xs text-muted-foreground">
                Or choose which alerts you get in <Link to="/account/alerts" className="font-semibold text-primary">Email alerts</Link>.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
