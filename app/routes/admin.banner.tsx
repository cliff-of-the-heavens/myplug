import { CopyIcon, LinkIcon } from "lucide-react";
import { data, Form, Link, useNavigation, useSearchParams } from "react-router";
import { CreativeFields } from "~/components/banner-forms";
import { FormError, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input } from "~/components/ui/input";
import { requireAdmin } from "~/lib/auth.server";
import { CAMPAIGN_STATUS_LABEL } from "~/lib/banners";
import { adminUpdateCreative, approveCampaign, BannerError, campaignDetail, createUploadLink, quoteCampaign, rejectCampaign } from "~/lib/banners.server";
import { today } from "~/lib/dates";
import { date, money, parseMoney } from "~/lib/format";
import { UploadError } from "~/lib/upload.server";
import { isUuid } from "~/lib/utils";
import type { Route } from "./+types/admin.banner";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.campaign.number} · Banner ads · MyPlug` : "Banner ad · MyPlug" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request);
  const campaign = isUuid(params.id) ? await campaignDetail(params.id) : null;
  if (!campaign) throw data("Ad not found", { status: 404 });
  return { campaign, today: today() };
}

export async function action({ request, params }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  const form = await request.formData();
  const id = params.id;
  try {
    switch (form.get("intent")) {
      case "quote":
        await quoteCampaign(id, parseMoney(form.get("amount")), String(form.get("note") ?? ""));
        return { ok: "Price confirmed and the advertiser was asked to pay." };
      case "approve":
        await approveCampaign(admin.id, id, form);
        return { ok: "Approved and scheduled. The advertiser was told." };
      case "reject":
        await rejectCampaign(id, String(form.get("note") ?? ""));
        return { ok: "Rejected. The advertiser was told why." };
      case "creative":
        await adminUpdateCreative(id, form);
        return { ok: "Banner saved." };
      case "link": {
        const r = await createUploadLink(id, { emailPasscode: form.get("emailPasscode") === "on" });
        return { ok: "Upload link created.", link: r.link, passcode: r.passcode, emailPasscode: form.get("emailPasscode") === "on" };
      }
    }
  } catch (e) {
    if (e instanceof BannerError || e instanceof UploadError) return { error: e.message };
    throw e;
  }
  return { error: "Unknown action." };
}

export default function AdminBanner({ loaderData, actionData }: Route.ComponentProps) {
  const { campaign: c } = loaderData;
  const [params] = useSearchParams();
  const busy = useNavigation().state !== "idle";
  const open = ["requested", "awaiting_payment", "payment_submitted"].includes(c.status);
  const link = actionData && "link" in actionData && actionData.link && actionData.passcode ? { link: actionData.link, passcode: actionData.passcode, emailPasscode: !!actionData.emailPasscode } : null;
  return (
    <div className="grid gap-6">
      <PageHeader
        title={c.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {c.number} · {c.placement.name} · {c.weeks} week{c.weeks > 1 ? "s" : ""}
            <Badge variant={c.status === "approved" ? "success" : c.status === "rejected" || c.status === "cancelled" ? "muted" : "highlight"}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link to="/admin/banners">All banner ads</Link>
          </Button>
        }
      />
      {params.get("created") ? <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">Ad saved. Next: add the banner (or send an upload link), then record payment and approve.</p> : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      {actionData && "ok" in actionData && !link ? <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}

      {link ? (
        <Card className="border-primary/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LinkIcon className="size-5" /> Upload link for {c.advertiserName}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Emailed to {c.advertiserEmail}{link.emailPasscode ? " with the passcode." : ". Give them the passcode by phone or SMS."} It's shown only now; create a new link if it's lost.
            </p>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <CopyRow label="Link" value={link.link} />
            <CopyRow label="Passcode" value={link.passcode} big />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Advertiser</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p>
              <strong>{c.advertiserName}</strong>
              {c.company ? ` · ${c.company}` : ""}{" "}
              {c.advertiser ? (
                <Link to={`/admin/users/${c.advertiser.id}`} className="text-primary hover:underline">
                  ({c.advertiser.role} account)
                </Link>
              ) : (
                <span className="text-muted-foreground">(no account)</span>
              )}
            </p>
            <p>{c.advertiserEmail}</p>
            {c.advertiserPhone ? <p>{c.advertiserPhone}</p> : null}
            {c.requestedStart ? <p>Wants to start: {c.requestedStart}</p> : null}
            {c.notes ? <p className="text-muted-foreground">"{c.notes}"</p> : null}
            {c.amountCents ? <p className="mt-2 text-base">Price: <strong>{money(c.amountCents, "MWK")}</strong></p> : null}
            {c.paymentReference || c.proofUrl ? (
              <p>
                Payment: {c.paymentReference ?? "no reference"}
                {c.proofUrl ? (
                  <>
                    {" · "}
                    <a href={c.proofUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                      view proof
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
            {c.status === "approved" && c.startsAt && c.endsAt ? (
              <p>
                Runs {date(c.startsAt)} to {date(c.endsAt)} · <strong>{c.clicks}</strong> click{c.clicks === 1 ? "" : "s"}
              </p>
            ) : null}
            {c.adminNote ? <p className="text-muted-foreground">Note: {c.adminNote}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Banner</CardTitle>
            <p className="text-sm text-muted-foreground">
              {c.placement.width}×{c.placement.height}px · up to {c.placement.maxKb} KB
              {c.creativeWidth ? ` · uploaded ${c.creativeWidth}×${c.creativeHeight}px` : ""}
            </p>
          </CardHeader>
          <CardContent className="grid gap-3">
            {c.creativeUrl ? <img src={c.creativeUrl} alt={c.headline ?? ""} className="w-full rounded-lg border object-contain" /> : <p className="text-sm text-muted-foreground">No banner yet.</p>}
            {c.headline ? <p className="text-sm">Headline: {c.headline}</p> : null}
            {c.linkUrl ? <p className="text-sm break-all">Links to: {c.linkUrl}</p> : null}
          </CardContent>
        </Card>
      </div>

      {open ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Load the banner yourself</CardTitle>
            </CardHeader>
            <CardContent>
              <Form method="post" encType="multipart/form-data" className="grid gap-4">
                <input type="hidden" name="intent" value="creative" />
                <CreativeFields placement={c.placement} defaults={{ headline: c.headline, linkUrl: c.linkUrl }} />
                <Button type="submit" variant="outline" disabled={busy} className="justify-self-start">
                  Save banner
                </Button>
              </Form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>…or send an upload link</CardTitle>
              <p className="text-sm text-muted-foreground">One-time link, valid 14 days, protected by a 6-digit passcode (locked after 5 wrong tries). Creating a new link cancels the old one.</p>
            </CardHeader>
            <CardContent>
              <Form method="post" className="grid gap-3">
                <input type="hidden" name="intent" value="link" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="emailPasscode" className="size-4 accent-primary" />
                  Include the passcode in the email (less secure than giving it by phone)
                </label>
                <Button type="submit" variant="outline" disabled={busy} className="justify-self-start">
                  Email upload link to {c.advertiserEmail}
                </Button>
                {c.uploadLinks[0] ? (
                  <p className="text-xs text-muted-foreground">
                    Last link: {date(c.uploadLinks[0].createdAt, true)} · {c.uploadLinks[0].usedAt ? "used / replaced" : `expires ${date(c.uploadLinks[0].expiresAt)}`} · {c.uploadLinks[0].attempts} wrong passcode{c.uploadLinks[0].attempts === 1 ? "" : "s"}
                  </p>
                ) : null}
              </Form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {open ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {c.status === "requested" ? (
            <Card>
              <CardHeader>
                <CardTitle>1. Confirm price & ask for payment</CardTitle>
              </CardHeader>
              <CardContent>
                <Form method="post" className="grid gap-3">
                  <input type="hidden" name="intent" value="quote" />
                  <Field label="Price" hint={`Standard: ${money(c.placement.weeklyCents * c.weeks, "MWK")}`}>
                    <Input name="amount" inputMode="decimal" defaultValue={c.amountCents ? String(c.amountCents / 100) : ""} />
                  </Field>
                  <Field label="Note to advertiser (optional)">
                    <Input name="note" />
                  </Field>
                  <Button type="submit" disabled={busy} className="justify-self-start">
                    Send payment request
                  </Button>
                </Form>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>{c.status === "requested" ? "Or approve now" : "Approve & schedule"}</CardTitle>
              <p className="text-sm text-muted-foreground">Confirm the payment arrived. Each spot rotates at most {c.placement.maxActive} ads at once.</p>
            </CardHeader>
            <CardContent>
              <Form method="post" className="grid gap-3">
                <input type="hidden" name="intent" value="approve" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Payment reference" hint={c.paymentReference ? "Reported by the advertiser" : "Required"}>
                    <Input name="reference" defaultValue={c.paymentReference ?? ""} required />
                  </Field>
                  <Field label="Start date">
                    <Input name="start" type="date" min={loaderData.today} defaultValue={c.requestedStart && c.requestedStart > loaderData.today ? c.requestedStart : loaderData.today} />
                  </Field>
                </div>
                <Button type="submit" disabled={busy || !c.creativeUrl} className="justify-self-start">
                  {c.creativeUrl ? "Payment received: approve" : "Add the banner first"}
                </Button>
              </Form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Reject</CardTitle>
            </CardHeader>
            <CardContent>
              <Form method="post" className="grid gap-3">
                <input type="hidden" name="intent" value="reject" />
                <Input name="note" required placeholder="Why? e.g. Banner has too much small text; misleading price." />
                <Button type="submit" variant="destructive" disabled={busy} className="justify-self-start">
                  Reject
                </Button>
              </Form>
            </CardContent>
          </Card>
        </div>
      ) : c.status === "approved" ? (
        <Card>
          <CardHeader>
            <CardTitle>Stop this ad</CardTitle>
          </CardHeader>
          <CardContent>
            <Form method="post" className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <input type="hidden" name="intent" value="reject" />
              <Input name="note" required placeholder="Why it's being taken down (sent to the advertiser)" />
              <Button type="submit" variant="destructive" disabled={busy}>
                Take down
              </Button>
            </Form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function CopyRow({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className={big ? "flex-1 text-lg font-bold tracking-[0.3em]" : "flex-1 text-xs break-all"}>{value}</code>
      <Button type="button" size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(value)} aria-label={`Copy ${label}`}>
        <CopyIcon />
      </Button>
    </div>
  );
}
