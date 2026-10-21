import { eq } from "drizzle-orm";
import { BanIcon, HourglassIcon, XCircleIcon } from "lucide-react";
import { Form, Link, redirect } from "react-router";
import { Container } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { requireMerchantAccount } from "~/lib/auth.server";
import { restoreArchivedStore } from "~/lib/retention.server";
import { date } from "~/lib/format";
import type { Route } from "./+types/sell.pending";

export const meta: Route.MetaFunction = () => [{ title: "Store approval · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchantAccount(request);
  if (user.storeStatus === "approved") throw redirect("/sell");
  // Archived only for inactivity: being here means they're back, so restore it.
  if (user.storeStatus === "archived") {
    await restoreArchivedStore(user.id);
    throw redirect("/sell");
  }
  const store = await db.query.stores.findFirst({
    where: eq(schema.stores.id, user.storeId),
    columns: { name: true, status: true, reviewNote: true, createdAt: true },
  });
  return { store: store!, email: user.email };
}

const COPY = {
  pending: {
    icon: HourglassIcon,
    tone: "bg-secondary text-secondary-foreground",
    title: "Your store is waiting for approval",
    text: "Our team checks every new store before it can sell. You'll be able to list products, take orders and advertise as soon as it's approved.",
  },
  rejected: {
    icon: XCircleIcon,
    tone: "bg-destructive/10 text-destructive",
    title: "Your store application wasn't approved",
    text: "Contact support if you think this is a mistake or you'd like to apply again.",
  },
  suspended: {
    icon: BanIcon,
    tone: "bg-destructive/10 text-destructive",
    title: "Your store has been suspended",
    text: "Your products are hidden from shoppers. Contact support to resolve this.",
  },
} as const;

export default function Pending({ loaderData }: Route.ComponentProps) {
  const { store, email } = loaderData;
  const copy = COPY[store.status as keyof typeof COPY];

  return (
    <Container className="grid max-w-xl place-items-center py-12">
      <Card className="w-full">
        <CardContent className="grid justify-items-center gap-4 pt-8 pb-8 text-center">
          <span className={`flex size-16 items-center justify-center rounded-full ${copy.tone}`}>
            <copy.icon className="size-8" />
          </span>
          <h1 className="text-2xl font-extrabold tracking-tight">{copy.title}</h1>
          <p className="text-muted-foreground">
            <strong className="text-foreground">{store.name}</strong> · applied {date(store.createdAt)}
          </p>
          <p className="text-sm text-muted-foreground">{copy.text}</p>
          {store.reviewNote ? (
            <p className="w-full rounded-lg bg-muted px-3 py-2 text-sm">
              <strong>Note from MyPlug:</strong> {store.reviewNote}
            </p>
          ) : null}
          {store.status === "pending" ? (
            <p className="text-xs text-muted-foreground">We'll use {email} if we need anything from you.</p>
          ) : null}
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link to="/sell/business">Upload business documents</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/">Browse MyPlug</Link>
            </Button>
            <Form method="post" action="/logout">
              <Button type="submit" variant="ghost">
                Sign out
              </Button>
            </Form>
          </div>
        </CardContent>
      </Card>
    </Container>
  );
}
