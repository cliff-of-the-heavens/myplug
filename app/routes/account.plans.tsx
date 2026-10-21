import { desc, eq } from "drizzle-orm";
import { CircleCheckBigIcon, PauseIcon, PlayIcon, RepeatIcon, XIcon } from "lucide-react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { Container, EmptyState, FormError, PageHeader } from "~/components/page";
import { PaymentReportForm } from "~/components/payment-report";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { requireCustomer } from "~/lib/auth.server";
import { formatDay, FREQUENCY_LABEL } from "~/lib/dates";
import { money, parseMoney, timeAgo } from "~/lib/format";
import { OrderError } from "~/lib/orders.server";
import { setPlanStatus, submitPrepayment } from "~/lib/recurring.server";
import { uploadProof, UploadError } from "~/lib/upload.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/account.plans";

export const meta: Route.MetaFunction = () => [{ title: "Repeat orders · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  const plans = await db.query.recurringPlans.findMany({
    where: eq(schema.recurringPlans.customerId, user.id),
    orderBy: desc(schema.recurringPlans.createdAt),
    with: {
      store: { columns: { name: true, slug: true } },
      product: { columns: { priceCents: true } },
      prepayments: { orderBy: desc(schema.planPrepayments.createdAt), limit: 5 },
      orders: {
        orderBy: desc(schema.orders.createdAt),
        limit: 5,
        columns: { id: true, number: true, bookingDate: true, status: true },
        with: { bill: { columns: { status: true } } },
      },
    },
  });
  return { plans };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const form = await request.formData();
  const planId = str(form.get("planId"));
  const intent = form.get("intent");
  try {
    if (intent === "pause" || intent === "resume" || intent === "cancel") {
      await setPlanStatus(user.id, planId, intent);
      return { ok: intent === "pause" ? "Paused. No deliveries until you resume." : intent === "resume" ? "Resumed." : "Cancelled." };
    }
    if (intent === "prepay") {
      const proofUrl = await uploadProof(form.get("proof"), "payments");
      await submitPrepayment({
        customerId: user.id,
        planId,
        amountCents: parseMoney(form.get("amount")) ?? 0,
        reference: str(form.get("reference")),
        proofUrl,
      });
      return { ok: "Thanks! The merchant will add it to your credit once they've checked it." };
    }
  } catch (e) {
    if (e instanceof OrderError || e instanceof UploadError) return { error: e.message };
    throw e;
  }
  return { error: "Unknown action." };
}

const STATUS_TONE = { active: "success", paused: "warning", cancelled: "muted", ended: "muted" } as const;

export default function Plans({ loaderData, actionData }: Route.ComponentProps) {
  const { plans } = loaderData;
  const [params] = useSearchParams();
  const busy = useNavigation().state !== "idle";

  return (
    <Container className="max-w-4xl py-8">
      {params.get("created") ? (
        <div className="mb-6 flex items-center gap-3 rounded-2xl bg-success/15 p-4 text-success">
          <CircleCheckBigIcon className="size-6 shrink-0" />
          <p className="font-semibold">Repeat order {params.get("created")} set up. Each delivery appears in My orders.</p>
        </div>
      ) : null}
      <PageHeader
        title="Repeat orders"
        description="Regular deliveries, like daily bread. Each delivery is its own order with its own bill."
        actions={
          <Button asChild variant="outline">
            <Link to="/account/orders">All orders</Link>
          </Button>
        }
      />
      {actionData && "ok" in actionData ? (
        <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p>
      ) : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />

      {plans.length === 0 ? (
        <EmptyState icon={RepeatIcon} title="No repeat orders yet">
          On a product page, tick <strong>Deliver on repeat</strong> to set one up.
        </EmptyState>
      ) : (
        <div className="mt-4 grid gap-4">
          {plans.map((p) => {
            const each = (p.product?.priceCents ?? 0) * p.quantity;
            const live = p.status === "active" || p.status === "paused";
            return (
              <Card key={p.id}>
                <CardContent className="grid gap-3 pt-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_TONE[p.status]} className="capitalize">{p.status}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">{p.number}</span>
                    <span className="font-bold">
                      {p.quantity}× {p.title}
                    </span>
                    <Link to={`/s/${p.store.slug}`} className="text-sm text-accent hover:underline">{p.store.name}</Link>
                    <span className="ml-auto font-bold">{money(each, p.currency)} each</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {FREQUENCY_LABEL[p.frequency]} from {formatDay(p.startOn)}
                    {p.endOn ? ` to ${formatDay(p.endOn)}` : ""}
                    {p.status === "active" && p.nextRunOn ? ` · next delivery ${formatDay(p.nextRunOn)}` : ""} ·{" "}
                    {p.paymentTiming === "prepaid" ? "paid in advance" : "pay after each delivery"}
                  </p>
                  {p.lastError ? <p className="rounded-lg bg-warning/20 px-3 py-2 text-sm">{p.lastError}</p> : null}

                  {p.paymentTiming === "prepaid" ? (
                    <div className="grid gap-2 rounded-xl border p-3">
                      <p className="text-sm">
                        Prepaid credit: <strong className="text-lg">{money(p.creditCents, p.currency)}</strong>
                        {each ? <span className="text-muted-foreground"> · covers {Math.floor(p.creditCents / each)} more deliveries</span> : null}
                      </p>
                      {p.prepayments.length ? (
                        <ul className="text-xs text-muted-foreground">
                          {p.prepayments.map((pp) => (
                            <li key={pp.id}>
                              {money(pp.amountCents, p.currency)} {pp.reference ? `(ref ${pp.reference})` : ""} · {pp.status} · {timeAgo(pp.createdAt)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {live ? (
                        <PaymentReportForm
                          intent="prepay"
                          hidden={{ planId: p.id }}
                          withAmount
                          amountLabel={`Amount paid (${p.currency})`}
                          submitLabel="Add prepayment"
                        />
                      ) : null}
                    </div>
                  ) : null}

                  {p.orders.length ? (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {p.orders.map((o) => (
                        <Link key={o.id} to={`/account/orders/${o.id}`} className="rounded-full border px-2 py-0.5 hover:border-primary">
                          {o.bookingDate ? formatDay(o.bookingDate) : o.number} · {o.status === "delivered" ? "delivered" : o.status}
                          {o.bill?.status === "paid" ? " · paid" : ""}
                        </Link>
                      ))}
                    </div>
                  ) : null}

                  {live ? (
                    <Form method="post" className="flex flex-wrap gap-2">
                      <input type="hidden" name="planId" value={p.id} />
                      {p.status === "active" ? (
                        <Button type="submit" name="intent" value="pause" size="sm" variant="outline" disabled={busy}>
                          <PauseIcon /> Pause
                        </Button>
                      ) : (
                        <Button type="submit" name="intent" value="resume" size="sm" disabled={busy}>
                          <PlayIcon /> Resume
                        </Button>
                      )}
                      <Button type="submit" name="intent" value="cancel" size="sm" variant="ghost" disabled={busy}>
                        <XIcon /> Cancel repeat order
                      </Button>
                    </Form>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </Container>
  );
}
