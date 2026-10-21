import { desc, eq } from "drizzle-orm";
import { CheckIcon, RepeatIcon, XIcon } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import { EmptyState, FormError, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { requireMerchant } from "~/lib/auth.server";
import { formatDay, FREQUENCY_LABEL } from "~/lib/dates";
import { money, timeAgo } from "~/lib/format";
import { OrderError } from "~/lib/orders.server";
import { reviewPrepayment } from "~/lib/recurring.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/sell.plans";

export const meta: Route.MetaFunction = () => [{ title: "Repeat orders · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const plans = await db.query.recurringPlans.findMany({
    where: eq(schema.recurringPlans.storeId, user.storeId),
    orderBy: desc(schema.recurringPlans.createdAt),
    limit: 200,
    with: {
      customer: { columns: { name: true } },
      prepayments: { where: eq(schema.planPrepayments.status, "submitted"), orderBy: desc(schema.planPrepayments.createdAt) },
    },
  });
  return { plans };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireMerchant(request);
  const form = await request.formData();
  try {
    await reviewPrepayment(user.storeId, str(form.get("prepaymentId")), form.get("intent") === "confirm");
    return { ok: form.get("intent") === "confirm" ? "Prepayment confirmed and added to the customer's credit." : "Prepayment rejected." };
  } catch (e) {
    if (e instanceof OrderError) return { error: e.message };
    throw e;
  }
}

const STATUS_TONE = { active: "success", paused: "warning", cancelled: "muted", ended: "muted" } as const;

export default function SellPlans({ loaderData, actionData }: Route.ComponentProps) {
  const { plans } = loaderData;
  const busy = useNavigation().state !== "idle";

  return (
    <>
      <PageHeader
        title="Repeat orders"
        description="Customers' regular deliveries. Each delivery is created as a normal order on its day, so it shows up under Orders."
      />
      {actionData && "ok" in actionData ? (
        <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p>
      ) : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />

      {plans.length === 0 ? (
        <EmptyState icon={RepeatIcon} title="No repeat orders yet">
          Customers can choose "Deliver on repeat" on any of your products.
        </EmptyState>
      ) : (
        <div className="mt-4 grid gap-3">
          {plans.map((p) => (
            <Card key={p.id}>
              <CardContent className="grid gap-2 pt-5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS_TONE[p.status]} className="capitalize">{p.status}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">{p.number}</span>
                  <span className="font-bold">
                    {p.quantity}× {p.title}
                  </span>
                  <span className="text-muted-foreground">for {p.customer.name}</span>
                  {p.paymentTiming === "prepaid" ? (
                    <span className="ml-auto">
                      Credit <strong>{money(p.creditCents, p.currency)}</strong>
                    </span>
                  ) : (
                    <span className="ml-auto text-muted-foreground">Pay after delivery</span>
                  )}
                </div>
                <p className="text-muted-foreground">
                  {FREQUENCY_LABEL[p.frequency]} from {formatDay(p.startOn)}
                  {p.endOn ? ` to ${formatDay(p.endOn)}` : ""}
                  {p.status === "active" && p.nextRunOn ? ` · next delivery ${formatDay(p.nextRunOn)}` : ""}
                </p>
                <p className="whitespace-pre-line text-muted-foreground">Deliver to: {p.shippingAddress}</p>
                {p.lastError ? <p className="rounded-lg bg-warning/20 px-3 py-2">{p.lastError}</p> : null}
                {p.prepayments.map((pp) => (
                  <Form key={pp.id} method="post" className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-dashed p-2">
                    <input type="hidden" name="prepaymentId" value={pp.id} />
                    <span>
                      Customer reports a prepayment of <strong>{money(pp.amountCents, p.currency)}</strong>
                      {pp.reference ? ` (ref ${pp.reference})` : ""} · {timeAgo(pp.createdAt)}
                    </span>
                    {pp.proofUrl ? (
                      <a href={pp.proofUrl} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">
                        Proof
                      </a>
                    ) : null}
                    <span className="ml-auto flex gap-2">
                      <Button type="submit" name="intent" value="confirm" size="sm" variant="accent" disabled={busy}>
                        <CheckIcon /> Received
                      </Button>
                      <Button type="submit" name="intent" value="reject" size="sm" variant="ghost" disabled={busy}>
                        <XIcon /> Not received
                      </Button>
                    </span>
                  </Form>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Deliveries are created each morning for the day. Prepaid plans pay each delivery from the customer's credit; when
        there isn't enough, the delivery's bill waits for payment. See <Link to="/sell/orders" className="font-semibold text-primary">Orders</Link>.
      </p>
    </>
  );
}
