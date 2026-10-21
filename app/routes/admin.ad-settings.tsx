import { eq } from "drizzle-orm";
import { useNavigation, Form } from "react-router";
import { FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input, Textarea } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { promotionTier, type PromotionTier } from "~/db/schema";
import { getBands, getSetting, PAYMENT_INSTRUCTIONS, setSetting } from "~/lib/ads.server";
import { requireAdmin } from "~/lib/auth.server";
import { parseMoney } from "~/lib/format";
import { TIER_WEIGHT } from "~/lib/promotions";
import { str } from "~/lib/utils";
import type { Route } from "./+types/admin.ad-settings";

export const meta: Route.MetaFunction = () => [{ title: "Bands & payment · Admin · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const [bands, instructions] = await Promise.all([getBands(), getSetting(PAYMENT_INSTRUCTIONS)]);
  return { bands, instructions: instructions ?? "" };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();

  if (form.get("intent") === "instructions") {
    const text = str(form.get("instructions"));
    if (text.length < 10) return { error: "Payment instructions are too short." };
    await setSetting(PAYMENT_INSTRUCTIONS, text.slice(0, 2000));
    return { ok: "Payment details saved." };
  }

  const tier = str(form.get("tier")) as PromotionTier;
  if (!promotionTier.enumValues.includes(tier)) return { error: "Unknown band." };
  const weeklyCents = parseMoney(form.get("weekly"));
  const name = str(form.get("name"));
  if (!weeklyCents) return { error: "Enter a weekly price." };
  if (name.length < 2) return { error: "Give the band a name." };
  await db
    .update(schema.adBands)
    .set({
      name: name.slice(0, 40),
      description: str(form.get("description")).slice(0, 300),
      weeklyCents,
      isActive: form.get("isActive") === "on",
      updatedAt: new Date(),
    })
    .where(eq(schema.adBands.tier, tier));
  // Adverts already billed keep their price; only new invoices use the new one.
  return { ok: `${name} saved.` };
}

export default function AdSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { bands, instructions } = loaderData;
  const busy = useNavigation().state !== "idle";

  return (
    <>
      <PageHeader
        title="Bands & payment details"
        description="The advertised bands merchants can buy, and how they should pay you. New prices apply to new invoices only."
      />
      {actionData && "ok" in actionData ? (
        <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p>
      ) : null}
      <div className="mb-4">
        <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {bands.map((b) => (
          <Card key={b.tier}>
            <CardContent className="pt-5">
              <Form method="post" className="grid gap-3">
                <input type="hidden" name="tier" value={b.tier} />
                <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
                  {b.tier} · {TIER_WEIGHT[b.tier] + 1}× feed weight
                </p>
                <Field label="Name">
                  <Input name="name" defaultValue={b.name} required maxLength={40} />
                </Field>
                <Field label="Price per week (MK)">
                  <Input name="weekly" inputMode="decimal" defaultValue={b.weeklyCents / 100} required />
                </Field>
                <Field label="What merchants get">
                  <Textarea name="description" rows={3} defaultValue={b.description} className="min-h-0" />
                </Field>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name="isActive" defaultChecked={b.isActive} className="size-4 accent-primary" />
                  Offered to merchants
                </label>
                <Button type="submit" size="sm" disabled={busy} className="justify-self-start">
                  Save {b.name}
                </Button>
              </Form>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Payment instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-3">
            <input type="hidden" name="intent" value="instructions" />
            <Field
              label="Shown to merchants when they have an advert to pay"
              hint="Bank account, mobile money numbers, and what to use as the reference."
            >
              <Textarea name="instructions" rows={6} defaultValue={instructions} required />
            </Field>
            <Button type="submit" disabled={busy} className="justify-self-start">
              Save payment details
            </Button>
          </Form>
          <p className="mt-4 text-xs text-muted-foreground">
            When an online payment provider (e.g. PayChangu, Paystack, Stripe) is connected, adverts can be approved
            automatically from the provider's payment webhook instead of by checking proofs.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
