import { desc, eq } from "drizzle-orm";
import { PercentIcon, TagIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { DateTimeField, toLocalInput } from "~/components/datetime-field";
import { FormError, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input, NativeSelect } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { requireMerchant } from "~/lib/auth.server";
import { createDeal, DealError, deleteDeal, listDeals, setDealActive } from "~/lib/deals.server";
import { currencySymbol, date, money } from "~/lib/format";
import { cn, str } from "~/lib/utils";
import type { Route } from "./+types/sell.deals";

export const meta: Route.MetaFunction = () => [{ title: "Deals & promo codes · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const [deals, products] = await Promise.all([
    listDeals(user.storeId),
    db.query.products.findMany({
      where: eq(schema.products.storeId, user.storeId),
      columns: { id: true, title: true },
      orderBy: desc(schema.products.createdAt),
    }),
  ]);
  return { deals, products, currency: user.storeCurrency };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireMerchant(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = str(form.get("id"));
  try {
    if (intent === "create") {
      await createDeal(user.storeId, form);
      return { ok: "Deal saved." };
    }
    if (intent === "pause" || intent === "resume") await setDealActive(user.storeId, id, intent === "resume");
    if (intent === "delete") await deleteDeal(user.storeId, id);
    return { ok: "Updated." };
  } catch (e) {
    if (e instanceof DealError) return { error: e.message };
    throw e;
  }
}

const local = (d: Date) => toLocalInput(d);

/** Quick date ranges merchants use most. */
function presets() {
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59);
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  sunday.setHours(23, 59, 0, 0);
  return [
    { label: "Next 24 hours", start: now, end: new Date(now.getTime() + 86_400_000) },
    { label: "This weekend", start: now, end: sunday },
    { label: "Until end of month", start: now, end: endOfMonth },
    { label: "No end date", start: null, end: null },
  ];
}

function status(d: { isActive: boolean; startsAt: Date | null; endsAt: Date | null; maxUses: number | null; usesCount: number }) {
  const now = Date.now();
  if (!d.isActive) return { label: "Paused", tone: "muted" as const };
  if (d.endsAt && d.endsAt.getTime() < now) return { label: "Ended", tone: "muted" as const };
  if (d.startsAt && d.startsAt.getTime() > now) return { label: "Scheduled", tone: "secondary" as const };
  if (d.maxUses != null && d.usesCount >= d.maxUses) return { label: "Used up", tone: "muted" as const };
  return { label: "Live", tone: "success" as const };
}

export default function Deals({ loaderData, actionData }: Route.ComponentProps) {
  const { deals, products, currency } = loaderData;
  const busy = useNavigation().state !== "idle";
  const [kind, setKind] = useState<"sale" | "code">("sale");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [range, setRange] = useState<{ start: string; end: string }>({ start: "", end: "" });

  return (
    <>
      <PageHeader title="Deals & promo codes" description="Run sales that apply automatically, or give customers a code to use at checkout." />
      {actionData && "ok" in actionData ? <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>New deal</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4" key={actionData && "ok" in actionData ? String(Date.now()) : "form"}>
            <input type="hidden" name="intent" value="create" />
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["sale", PercentIcon, "Sale", "Automatic % off: timed deals, end-of-month, store-wide or chosen items"],
                  ["code", TagIcon, "Promo code", "Customers enter a code at checkout"],
                ] as const
              ).map(([v, Icon, label, text]) => (
                <label key={v} className={cn("flex cursor-pointer gap-2 rounded-xl border-2 p-3 text-sm", kind === v ? "border-primary bg-primary/5" : "hover:border-primary/40")}>
                  <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} className="mt-0.5 accent-primary" />
                  <Icon className="mt-0.5 size-4 text-primary" />
                  <span className="grid">
                    <span className="font-semibold">{label}</span>
                    <span className="text-xs text-muted-foreground">{text}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name shown to customers" className="sm:col-span-2">
                <Input name="name" required placeholder={kind === "sale" ? "End of month sale" : "Welcome discount"} />
              </Field>
              {kind === "code" ? (
                <Field label="Code">
                  <Input name="code" required placeholder="WELCOME10" className="uppercase" />
                </Field>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {kind === "code" ? (
                <Field label="Discount type">
                  <NativeSelect name="discountType" value={discountType} onChange={(e) => setDiscountType(e.target.value as "percent" | "amount")}>
                    <option value="percent">Percentage off</option>
                    <option value="amount">Fixed amount off</option>
                  </NativeSelect>
                </Field>
              ) : null}
              {kind === "code" && discountType === "amount" ? (
                <Field label={`Amount off (${currencySymbol(currency)})`}>
                  <Input name="amountOff" inputMode="decimal" required />
                </Field>
              ) : (
                <Field label="Percent off">
                  <Input name="percentOff" type="number" min={1} max={90} required placeholder="15" />
                </Field>
              )}
              {kind === "code" ? (
                <Field label={`Minimum spend (${currencySymbol(currency)}, optional)`}>
                  <Input name="minSpend" inputMode="decimal" />
                </Field>
              ) : null}
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-semibold">When</legend>
              <div className="flex flex-wrap gap-2">
                {presets().map((p) => (
                  <Button key={p.label} type="button" size="sm" variant="outline" onClick={() => setRange({ start: p.start ? local(p.start) : "", end: p.end ? local(p.end) : "" })}>
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Starts (empty = now)">
                  <DateTimeField name="startsAt" value={range.start} onChange={(v) => setRange((r) => ({ ...r, start: v }))} />
                </Field>
                <Field label="Ends (empty = until you stop it)">
                  <DateTimeField name="endsAt" value={range.end} onChange={(v) => setRange((r) => ({ ...r, end: v }))} />
                </Field>
              </div>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-semibold">Applies to</legend>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="scope" value="all" checked={scope === "all"} onChange={() => setScope("all")} className="accent-primary" /> Everything in my store</label>
                <label className="flex items-center gap-2"><input type="radio" name="scope" value="selected" checked={scope === "selected"} onChange={() => setScope("selected")} className="accent-primary" /> Chosen items</label>
              </div>
              {scope === "selected" ? (
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-xl border p-2 sm:grid-cols-2">
                  {products.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 rounded-lg p-1.5 text-sm hover:bg-muted">
                      <input type="checkbox" name="productId" value={p.id} className="size-4 accent-primary" /> <span className="truncate">{p.title}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </fieldset>

            {kind === "code" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Total uses allowed (optional)">
                  <Input name="maxUses" type="number" min={1} />
                </Field>
                <Field label="Uses per customer (optional)">
                  <Input name="perCustomer" type="number" min={1} placeholder="1" />
                </Field>
              </div>
            ) : null}
            <Button type="submit" disabled={busy} className="justify-self-start">Save deal</Button>
          </Form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Your deals</CardTitle>
        </CardHeader>
        <CardContent>
          {deals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {deals.map((d) => {
                const st = status(d);
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 py-3">
                    <Badge variant={st.tone}>{st.label}</Badge>
                    <span className="font-semibold">{d.name}</span>
                    {d.code ? <span className="rounded bg-muted px-1.5 font-mono text-xs">{d.code}</span> : null}
                    <span className="text-muted-foreground">
                      {d.percentOff ? `${d.percentOff}% off` : `${money(d.amountOffCents ?? 0, currency)} off`} ·{" "}
                      {d.allProducts ? "all items" : d.products.map((p) => p.product.title).join(", ")}
                      {d.startsAt ? ` · from ${date(d.startsAt, true)}` : ""}
                      {d.endsAt ? ` · until ${date(d.endsAt, true)}` : ""}
                      {d.kind === "code" ? ` · used ${d.usesCount}${d.maxUses ? `/${d.maxUses}` : ""}` : ""}
                      {d.minSpendCents ? ` · min ${money(d.minSpendCents, currency)}` : ""}
                    </span>
                    <Form method="post" className="ml-auto flex gap-1">
                      <input type="hidden" name="id" value={d.id} />
                      <Button type="submit" name="intent" value={d.isActive ? "pause" : "resume"} size="sm" variant="ghost">{d.isActive ? "Pause" : "Resume"}</Button>
                      <Button type="submit" name="intent" value="delete" size="icon-sm" variant="ghost" aria-label="Delete"><Trash2Icon /></Button>
                    </Form>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
