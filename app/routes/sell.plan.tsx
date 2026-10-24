import { Form, useNavigation } from "react-router";
import { FormError, PageHeader } from "~/components/page";
import { PaymentReportForm } from "~/components/payment-report";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { NativeSelect } from "~/components/ui/input";
import { requireMerchant } from "~/lib/auth.server";
import { bandPrice, MAX_MONTHS } from "~/lib/bands";
import { BandError, cancelBandRequest, listBands, requestBand, storeBandRequests, storePlan, submitBandPayment } from "~/lib/bands.server";
import { date, money } from "~/lib/format";
import { getSetting } from "~/lib/settings.server";
import { uploadProof, UploadError } from "~/lib/upload.server";
import { cn, str } from "~/lib/utils";
import type { Route } from "./+types/sell.plan";

export const meta: Route.MetaFunction = () => [{ title: "Store plan · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const [plan, bands, requests, payment] = await Promise.all([storePlan(user.storeId!), listBands({ activeOnly: true }), storeBandRequests(user.storeId!), getSetting("payment_instructions")]);
  return { plan, bands, requests, payment };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireMerchant(request);
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    if (intent === "request") {
      const r = await requestBand(user.storeId!, str(form.get("bandId")), Number(form.get("months")));
      return { ok: `Request ${r.number} created. Pay below to switch plans.` };
    }
    if (intent === "pay") {
      await submitBandPayment(user.storeId!, str(form.get("requestId")), String(form.get("reference") ?? ""), await uploadProof(form.get("proof"), "proofs"));
      return { ok: "Thanks! Your plan changes as soon as an admin confirms the payment." };
    }
    if (intent === "cancel") {
      await cancelBandRequest(user.storeId!, str(form.get("requestId")));
      return { ok: "Request cancelled." };
    }
  } catch (e) {
    if (e instanceof BandError || e instanceof UploadError) return { error: e.message };
    throw e;
  }
  return { error: "Unknown action." };
}

const STATUS: Record<string, string> = { requested: "Awaiting payment", payment_submitted: "Payment being checked", approved: "Approved", rejected: "Not approved" };

export default function SellPlan({ loaderData, actionData }: Route.ComponentProps) {
  const { plan, bands, requests, payment } = loaderData;
  const busy = useNavigation().state !== "idle";
  const open = requests.find((r) => r.status === "requested");
  const pct = plan.limit ? Math.min(100, Math.round((plan.used / plan.limit) * 100)) : 0;
  return (
    <div className="grid gap-6">
      <PageHeader title="Store plan" description="Your plan sets how many listings your store can have. Archived listings don't count." />
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      {actionData && "ok" in actionData ? <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}

      <Card>
        <CardContent className="grid gap-3 pt-5">
          <p className="text-lg font-bold">
            {plan.band?.name ?? "No plan"} <span className="text-sm font-normal text-muted-foreground">{plan.band ? bandPrice(plan.band.monthlyCents) : ""}</span>
          </p>
          <p className="text-sm">
            {plan.used} of {plan.limit ?? "unlimited"} listings used{plan.paidUntil ? ` · paid until ${date(plan.paidUntil)}` : ""}
          </p>
          {plan.limit ? (
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
            </div>
          ) : null}
          {plan.expired ? <p className="text-sm text-destructive">Your paid plan has ended, so you're back on the free plan. Existing listings stay; renew to add more.</p> : null}
        </CardContent>
      </Card>

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Pay for {open.number}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm">
              {open.band.name}, {open.months} month{open.months > 1 ? "s" : ""}: pay <strong>{money(open.amountCents, "MWK")}</strong> using reference <strong>{open.number}</strong>.{payment ? ` ${payment}` : ""}
            </p>
            <PaymentReportForm intent="pay" hidden={{ requestId: open.id }} submitLabel="I've paid: notify MyPlug" />
            <Form method="post">
              <input type="hidden" name="requestId" value={open.id} />
              <Button type="submit" name="intent" value="cancel" variant="ghost" size="sm">
                Cancel request
              </Button>
            </Form>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {bands.map((b) => (
            <Form key={b.id} method="post" className={cn("grid content-start gap-2 rounded-2xl border bg-card p-4", plan.band?.id === b.id && "border-2 border-primary")}>
              <input type="hidden" name="intent" value="request" />
              <input type="hidden" name="bandId" value={b.id} />
              <p className="flex items-center gap-2 font-bold">
                {b.name} {plan.band?.id === b.id ? <Badge variant="success">Current</Badge> : null}
              </p>
              <p className="text-2xl font-extrabold text-primary">{b.maxItems ?? "Unlimited"}</p>
              <p className="-mt-2 text-xs text-muted-foreground">listings</p>
              <p className="text-sm font-semibold">{bandPrice(b.monthlyCents)}</p>
              {b.monthlyCents > 0 ? (
                <>
                  <NativeSelect name="months" defaultValue="1" aria-label="Months">
                    {Array.from({ length: MAX_MONTHS }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {m} month{m > 1 ? "s" : ""} · {money(b.monthlyCents * m, "MWK")}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button type="submit" size="sm" disabled={busy}>
                    {plan.band?.id === b.id ? "Renew" : "Choose"}
                  </Button>
                </>
              ) : null}
            </Form>
          ))}
        </div>
      )}

      {requests.length ? (
        <section className="grid gap-2">
          <h2 className="font-bold">History</h2>
          {requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm">
              <span className="font-semibold">{r.number}</span>
              <span>
                {r.band.name} · {r.months} month{r.months > 1 ? "s" : ""} · {money(r.amountCents, "MWK")}
              </span>
              <Badge variant={r.status === "approved" ? "success" : r.status === "rejected" ? "muted" : "highlight"}>{STATUS[r.status]}</Badge>
              {r.adminNote ? <span className="text-muted-foreground">{r.adminNote}</span> : null}
              <span className="ml-auto text-xs text-muted-foreground">{date(r.createdAt)}</span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
