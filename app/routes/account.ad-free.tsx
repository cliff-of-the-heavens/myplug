import { EyeOffIcon } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { Container, FormError, PageHeader } from "~/components/page";
import { PaymentReportForm } from "~/components/payment-report";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { requireUser } from "~/lib/auth.server";
import { adFreePrices, BannerError, myPasses, requestAdFree, submitAdFreePayment } from "~/lib/banners.server";
import { date, money } from "~/lib/format";
import { getSetting } from "~/lib/settings.server";
import { uploadProof, UploadError } from "~/lib/upload.server";
import { str } from "~/lib/utils";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/account.ad-free";

export const meta: Route.MetaFunction = () => [{ title: "Ad-free browsing · MyPlug" }];

const STATUS: Record<string, string> = { requested: "Awaiting payment", payment_submitted: "Payment being checked", approved: "Active / used", rejected: "Not approved" };

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const [plans, passes, me, payment] = await Promise.all([
    adFreePrices(),
    myPasses(user.id),
    db.query.users.findFirst({ where: eq(schema.users.id, user.id), columns: { adFreeUntil: true } }),
    getSetting("payment_instructions"),
  ]);
  const until = me?.adFreeUntil && me.adFreeUntil > new Date() ? me.adFreeUntil : null;
  return { plans, passes, until, payment };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  try {
    if (form.get("intent") === "pay") {
      const proof = await uploadProof(form.get("proof"), "proofs");
      await submitAdFreePayment(user.id, str(form.get("passId")), String(form.get("reference") ?? ""), proof);
      return { ok: "Thanks! Ad-free browsing starts as soon as an admin confirms your payment." };
    }
    const pass = await requestAdFree(user.id, Number(form.get("days")));
    return { ok: `Request ${pass.number} created. Pay below to switch it on.` };
  } catch (e) {
    if (e instanceof BannerError || e instanceof UploadError) return { error: e.message };
    throw e;
  }
}

export default function AdFree({ loaderData, actionData }: Route.ComponentProps) {
  const { plans, passes, until, payment } = loaderData;
  const busy = useNavigation().state !== "idle";
  const open = passes.find((p) => p.status === "requested");
  return (
    <Container className="grid max-w-3xl gap-6 py-8">
      <PageHeader title="Ad-free browsing" description="Hide the banner strips and side banners while you shop." />
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      {actionData && "ok" in actionData ? <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}

      {until ? (
        <p className="flex items-center gap-2 rounded-2xl bg-success/15 p-4 font-semibold text-success">
          <EyeOffIcon className="size-5" /> Ad-free until {date(until)}. Buying another plan adds to the time left.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>What's hidden</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm text-muted-foreground">
          <p>Home page banner strips, search and category banners, and side banners.</p>
          <p>The home page's main slide and "Sponsored" product labels stay: they're part of how shops are found, and they're never pop-ups.</p>
        </CardContent>
      </Card>

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Pay for {open.number}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm">
              Pay <strong>{money(open.amountCents, "MWK")}</strong> using reference <strong>{open.number}</strong>.{payment ? ` ${payment}` : ""}
            </p>
            <PaymentReportForm intent="pay" hidden={{ passId: open.id }} submitLabel="I've paid: notify MyPlug" />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {plans.map((p) => (
            <Form key={p.days} method="post" className="grid gap-2 rounded-2xl border bg-card p-4 text-center">
              <input type="hidden" name="days" value={p.days} />
              <p className="font-bold">{p.label}</p>
              <p className="text-2xl font-extrabold text-primary">{money(p.amountCents, "MWK")}</p>
              <Button type="submit" disabled={busy} variant={p.days === 90 ? "default" : "outline"}>
                Choose
              </Button>
            </Form>
          ))}
        </div>
      )}

      {passes.length ? (
        <section className="grid gap-2">
          <h2 className="font-bold">Your passes</h2>
          {passes.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm">
              <span className="font-semibold">{p.number}</span>
              <span>{p.days} days · {money(p.amountCents, "MWK")}</span>
              <Badge variant={p.status === "approved" ? "success" : p.status === "rejected" ? "muted" : "highlight"}>{STATUS[p.status]}</Badge>
              <span className="ml-auto text-xs text-muted-foreground">{date(p.createdAt)}</span>
            </div>
          ))}
        </section>
      ) : null}
    </Container>
  );
}
