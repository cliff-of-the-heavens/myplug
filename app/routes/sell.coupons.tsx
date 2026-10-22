import { desc, eq } from "drizzle-orm";
import { GiftIcon, ScanLineIcon } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { FormError, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { requireMerchant } from "~/lib/auth.server";
import { CouponError, couponState, findCoupon, redeemInStore } from "~/lib/coupons.server";
import { currencySymbol, date, money, parseMoney } from "~/lib/format";
import { str } from "~/lib/utils";
import type { Route } from "./+types/sell.coupons";

export const meta: Route.MetaFunction = () => [{ title: "Gift coupons · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const [store, sold] = await Promise.all([
    db.query.stores.findFirst({
      where: eq(schema.stores.id, user.storeId),
      columns: { couponsEnabled: true, couponMinCents: true, couponMaxCents: true, couponValidityDays: true, slug: true, currency: true },
    }),
    db.query.coupons.findMany({
      where: eq(schema.coupons.storeId, user.storeId),
      orderBy: desc(schema.coupons.createdAt),
      limit: 100,
      with: { redemptions: { orderBy: desc(schema.couponRedemptions.createdAt), limit: 5 } },
    }),
  ]);
  // Show only the end of each code: the full code is the coupon's value.
  return { store: store!, sold: sold.map(({ code, ...c }) => ({ ...c, codeEnd: code.slice(-4), state: couponState({ ...c, status: c.status }) })) };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireMerchant(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "settings") {
    const min = parseMoney(form.get("min"));
    const max = parseMoney(form.get("max"));
    const days = Math.floor(Number(form.get("validity")));
    if (min && max && max < min) return { error: "The largest amount must be at least the smallest." };
    if (!(days >= 30 && days <= 1825)) return { error: "Coupons must be valid for 30 days to 5 years." };
    await db
      .update(schema.stores)
      .set({ couponsEnabled: form.get("enabled") === "on", couponMinCents: min || null, couponMaxCents: max || null, couponValidityDays: days })
      .where(eq(schema.stores.id, user.storeId));
    return { ok: "Saved." };
  }

  const code = str(form.get("code"));
  if (intent === "lookup") {
    const c = await findCoupon(code);
    if (!c || c.storeId !== user.storeId) return { error: "No gift coupon for your store has that code." };
    return { coupon: { code: c.code, state: couponState(c), balanceCents: c.balanceCents, currency: c.currency, expiresAt: c.expiresAt, recipientName: c.recipientName } };
  }
  if (intent === "redeem") {
    try {
      const r = await redeemInStore({ storeId: user.storeId, code, amountCents: parseMoney(form.get("amount")) ?? 0, staffId: user.id, note: str(form.get("note")) });
      return { ok: `Taken from the coupon. ${money(r.balance, r.coupon.currency)} left on it.` };
    } catch (e) {
      if (e instanceof CouponError) return { error: e.message };
      throw e;
    }
  }
  return { error: "Unknown action." };
}

const TONE = { pending: "warning", active: "success", used: "muted", expired: "muted", void: "destructive" } as const;

export default function SellCoupons({ loaderData, actionData }: Route.ComponentProps) {
  const { store, sold } = loaderData;
  const busy = useNavigation().state !== "idle";
  const found = actionData && "coupon" in actionData ? actionData.coupon : null;
  const sym = currencySymbol(store.currency);

  return (
    <>
      <PageHeader title="Gift coupons" description="Customers buy coupons from your store and give them to anyone. They spend them at checkout or at your counter." />
      {actionData && "ok" in actionData ? <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />

      <Card className="mt-4 border-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ScanLineIcon className="size-5 text-primary" /> Take a coupon at the counter</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Form method="post" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="lookup" />
            <Field label="Coupon code" className="flex-1">
              <Input name="code" required placeholder="GIFT-XXXX-XXXX-XXXX" defaultValue={found?.code ?? ""} className="uppercase" autoComplete="off" />
            </Field>
            <Button type="submit" variant="outline" disabled={busy}>Check balance</Button>
          </Form>
          {found ? (
            <div className="grid gap-2 rounded-xl bg-secondary/60 p-3 text-sm">
              <p>
                <Badge variant={TONE[found.state]} className="capitalize">{found.state}</Badge>{" "}
                Balance <strong className="text-lg">{money(found.balanceCents, found.currency)}</strong>
                {found.expiresAt ? ` · valid until ${date(found.expiresAt)}` : ""}
                {found.recipientName ? ` · for ${found.recipientName}` : ""}
              </p>
              {found.state === "active" ? (
                <Form method="post" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="intent" value="redeem" />
                  <input type="hidden" name="code" value={found.code} />
                  <Field label={`Amount to take (${sym})`}>
                    <Input name="amount" inputMode="decimal" required className="w-36" />
                  </Field>
                  <Field label="Note (optional)" className="flex-1">
                    <Input name="note" placeholder="e.g. Receipt 1043" />
                  </Field>
                  <Button type="submit" variant="accent" disabled={busy}>Take payment</Button>
                </Form>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><GiftIcon className="size-5 text-primary" /> Selling coupons</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="intent" value="settings" />
            <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-3">
              <input type="checkbox" name="enabled" defaultChecked={store.couponsEnabled} className="size-4 accent-primary" />
              Customers can buy gift coupons from my store
            </label>
            <Field label={`Smallest amount (${sym})`}>
              <Input name="min" inputMode="decimal" defaultValue={store.couponMinCents ? store.couponMinCents / 100 : ""} />
            </Field>
            <Field label={`Largest amount (${sym})`}>
              <Input name="max" inputMode="decimal" defaultValue={store.couponMaxCents ? store.couponMaxCents / 100 : ""} />
            </Field>
            <Field label="Valid for (days)">
              <Input name="validity" type="number" min={30} max={1825} defaultValue={store.couponValidityDays} />
            </Field>
            <Button type="submit" disabled={busy} className="justify-self-start">Save</Button>
          </Form>
          <p className="mt-3 text-xs text-muted-foreground">
            Buyers pay you first. The coupon becomes usable once you mark that order paid (Orders). Coupon link for customers: /s/{store.slug}/gift
          </p>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Coupons sold</CardTitle>
        </CardHeader>
        <CardContent>
          {sold.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {sold.map((c) => (
                <li key={c.id} className="grid gap-1 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={TONE[c.state]} className="capitalize">{c.state}</Badge>
                    <span className="font-mono text-xs">…{c.codeEnd}</span>
                    <span>{money(c.balanceCents, c.currency)} of {money(c.initialCents, c.currency)} left</span>
                    {c.recipientName ? <span className="text-muted-foreground">for {c.recipientName}</span> : null}
                    <span className="ml-auto text-xs text-muted-foreground">{date(c.createdAt)}</span>
                  </div>
                  {c.redemptions.length ? (
                    <p className="text-xs text-muted-foreground">
                      {c.redemptions.map((r) => `${r.amountCents < 0 ? "refund " : ""}${money(Math.abs(r.amountCents), c.currency)} ${r.channel === "in_store" ? "at the counter" : "online"} ${date(r.createdAt)}`).join(" · ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
