import { EyeOffIcon, MailIcon, MegaphoneIcon, RocketIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { AuthLink } from "~/components/auth-dialog";
import { CreativeFields, PlacementTable, PreparationTips } from "~/components/banner-forms";
import { Container, FormError, PageHeader } from "~/components/page";
import { PaymentReportForm } from "~/components/payment-report";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "~/components/ui/input";
import { getUser } from "~/lib/auth.server";
import { CAMPAIGN_STATUS_LABEL, MAX_WEEKS, NON_INTRUSIVE_POLICY } from "~/lib/banners";
import { BannerError, bannerSettings, cancelOwnCampaign, getPlacements, myCampaigns, requestCampaign, submitCampaignPayment } from "~/lib/banners.server";
import { today } from "~/lib/dates";
import { date, money } from "~/lib/format";
import { getSetting } from "~/lib/settings.server";
import { uploadProof, UploadError } from "~/lib/upload.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/advertise";

export const meta: Route.MetaFunction = () => [
  { title: "Advertise on MyPlug" },
  { name: "description", content: "Banner ads on the MyPlug home page, search and side panels: sizes, prices and how to book." },
];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  const [placements, settings, mine, payment] = await Promise.all([
    getPlacements({ activeOnly: true }),
    bannerSettings(),
    user ? myCampaigns(user.id) : [],
    getSetting("payment_instructions"),
  ]);
  return {
    placements,
    adsEmail: settings.adsEmail,
    mine,
    payment,
    canRequest: !!user && user.role !== "admin",
    role: user?.role ?? null,
    today: today(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await getUser(request);
  if (!user) return { error: "Sign in to request an ad." };
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    if (intent === "request") {
      const c = await requestCampaign(user, form);
      return { ok: `Request ${c.number} sent. An admin will check your banner and confirm the price.` };
    }
    if (intent === "pay") {
      const proof = await uploadProof(form.get("proof"), "proofs");
      await submitCampaignPayment(user.id, str(form.get("campaignId")), String(form.get("reference") ?? ""), proof);
      return { ok: "Thanks! An admin will confirm your payment and schedule the ad." };
    }
    if (intent === "cancel") {
      await cancelOwnCampaign(user.id, str(form.get("campaignId")));
      return { ok: "Request cancelled." };
    }
  } catch (e) {
    if (e instanceof BannerError || e instanceof UploadError) return { error: e.message };
    throw e;
  }
  return { error: "Unknown action." };
}

export default function Advertise({ loaderData, actionData }: Route.ComponentProps) {
  const { placements, adsEmail, mine, payment, canRequest, role } = loaderData;
  const mailto = `mailto:${adsEmail}?subject=${encodeURIComponent("Advertising on MyPlug")}&body=${encodeURIComponent(
    "Hello MyPlug,\n\nI'd like to advertise.\n\nName / company:\nPhone:\nAd spot (e.g. Home page hero):\nNumber of weeks:\nPreferred start date:\nWebsite or page the ad should link to:\n\nThank you.",
  )}`;
  return (
    <Container className="grid max-w-5xl gap-10 py-8">
      <PageHeader title="Advertise on MyPlug" description="Put your brand in front of shoppers across Malawi, without annoying them." />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RocketIcon className="size-5 text-primary" /> Boost your products
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground">
            <p>For merchants: your listings show higher in the storefront, search and "Sponsored picks", fairly shared between stores.</p>
            {role === "merchant" ? (
              <Button asChild variant="outline" className="w-fit">
                <Link to="/sell/promote">Boost a product</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MegaphoneIcon className="size-5 text-primary" /> Banner ads
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            For anyone: your own designed banner in one of the spots below. Every banner is checked by an admin, then runs for the weeks you book.
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-4">
        <h2 className="text-xl font-extrabold">Ad spots, sizes and prices</h2>
        <PlacementTable placements={placements} />
        <p className="flex items-start gap-2 rounded-xl bg-secondary/60 p-3 text-sm">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
          {NON_INTRUSIVE_POLICY}
        </p>
      </section>

      <section className="grid gap-4">
        <h2 className="text-xl font-extrabold">How to prepare your banner</h2>
        <Card>
          <CardContent className="pt-5">
            <PreparationTips />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4" id="request">
        <h2 className="text-xl font-extrabold">Book a banner</h2>
        <FormError error={actionData && "error" in actionData ? actionData.error : null} />
        {actionData && "ok" in actionData ? <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}
        {canRequest ? (
          <RequestForm placements={placements} min={loaderData.today} />
        ) : (
          <Card>
            <CardContent className="grid gap-3 pt-5 text-sm">
              <p>
                <strong>Have a MyPlug account?</strong>{" "}
                <AuthLink mode="login" className="font-semibold text-primary hover:underline">
                  Sign in
                </AuthLink>{" "}
                to upload your banner and book online.
              </p>
              <p>
                <strong>Not a member?</strong> Email us and we'll set it up for you. You can send your banner by email, or we'll send you a secure upload link.
              </p>
              <Button asChild variant="outline" className="w-fit">
                <a href={mailto}>
                  <MailIcon /> Email {adsEmail}
                </a>
              </Button>
            </CardContent>
          </Card>
        )}
      </section>

      {mine.length ? (
        <section className="grid gap-4" id="my-ads">
          <h2 className="text-xl font-extrabold">Your banner ads</h2>
          {mine.map((c) => (
            <Card key={c.id}>
              <CardContent className="grid gap-3 pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{c.title}</span>
                  <Badge variant={c.status === "approved" ? "success" : c.status === "rejected" || c.status === "cancelled" ? "muted" : "highlight"}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {c.number} · {c.placement.name} · {c.weeks} week{c.weeks > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                  {c.creativeUrl ? <img src={c.creativeUrl} alt="" className="max-h-32 w-full rounded-lg border object-contain" /> : null}
                  <div className="grid content-start gap-1 text-sm">
                    {c.amountCents ? <p>Price: <strong>{money(c.amountCents, "MWK")}</strong></p> : null}
                    {c.status === "approved" && c.startsAt && c.endsAt ? (
                      <p>
                        Runs {date(c.startsAt)} to {date(c.endsAt)} · {c.clicks} click{c.clicks === 1 ? "" : "s"}
                      </p>
                    ) : null}
                    {c.adminNote ? <p className="text-muted-foreground">Admin: {c.adminNote}</p> : null}
                  </div>
                </div>
                {c.status === "awaiting_payment" ? (
                  <div className="grid gap-2">
                    <p className="text-sm">
                      Pay <strong>{money(c.amountCents ?? 0, "MWK")}</strong> using reference <strong>{c.number}</strong>.{payment ? ` ${payment}` : ""}
                    </p>
                    <PaymentReportForm intent="pay" hidden={{ campaignId: c.id }} submitLabel="I've paid: notify MyPlug" />
                  </div>
                ) : null}
                {c.status === "requested" || c.status === "awaiting_payment" ? (
                  <Form method="post">
                    <input type="hidden" name="campaignId" value={c.id} />
                    <Button type="submit" name="intent" value="cancel" variant="ghost" size="sm">
                      Cancel request
                    </Button>
                  </Form>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <EyeOffIcon className="size-4" /> Prefer fewer ads while you shop?{" "}
        <Link to="/account/ad-free" className="font-semibold text-primary hover:underline">
          Get ad-free browsing
        </Link>
      </p>
    </Container>
  );
}

function RequestForm({ placements, min }: { placements: Route.ComponentProps["loaderData"]["placements"]; min: string }) {
  const [key, setKey] = useState(placements[0]?.key ?? "");
  const [weeks, setWeeks] = useState(1);
  const busy = useNavigation().formData?.get("intent") === "request";
  const placement = placements.find((p) => p.key === key);
  return (
    <Card>
      <CardContent className="pt-5">
        <Form method="post" encType="multipart/form-data" className="grid gap-4">
          <input type="hidden" name="intent" value="request" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Ad spot">
              <NativeSelect name="placement" value={key} onChange={(e) => setKey(e.target.value)}>
                {placements.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} ({p.width}×{p.height})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Weeks">
              <Input name="weeks" type="number" min={1} max={MAX_WEEKS} value={weeks} onChange={(e) => setWeeks(Math.max(1, Math.min(MAX_WEEKS, Number(e.target.value) || 1)))} />
            </Field>
            <Field label="Start from" hint="Subject to a free slot">
              <Input name="start" type="date" min={min} />
            </Field>
          </div>
          <Field label="Ad name" hint="For your own reference">
            <Input name="title" maxLength={80} placeholder="e.g. December sale" />
          </Field>
          <CreativeFields placement={placement} required />
          <Field label="Anything else? (optional)">
            <Textarea name="notes" rows={2} maxLength={1000} placeholder="e.g. Please run it in the week of payday." />
          </Field>
          {placement ? (
            <p className="text-sm">
              Estimated price: <strong>{money(placement.weeklyCents * weeks, "MWK")}</strong> ({weeks} × {money(placement.weeklyCents, "MWK")}). An admin confirms the final price before you pay.
            </p>
          ) : null}
          <Button type="submit" disabled={busy} className="justify-self-start">
            {busy ? "Sending..." : "Send request"}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}
