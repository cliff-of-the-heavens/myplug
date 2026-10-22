import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { CreativeFields } from "~/components/banner-forms";
import { FormError, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "~/components/ui/input";
import { requireAdmin } from "~/lib/auth.server";
import { CAMPAIGN_STATUS_LABEL, MAX_WEEKS } from "~/lib/banners";
import { adminCampaigns, adminPasses, BannerError, createExternalCampaign, decideAdFree, getPlacements, type CampaignFilter } from "~/lib/banners.server";
import { today } from "~/lib/dates";
import { date, money } from "~/lib/format";
import { cn, str } from "~/lib/utils";
import type { Route } from "./+types/admin.banners";

export const meta: Route.MetaFunction = () => [{ title: "Banner ads · Admin · MyPlug" }];

const TABS = [
  { value: "action", label: "Needs action" },
  { value: "live", label: "Running & booked" },
  { value: "all", label: "All" },
  { value: "passes", label: "Ad-free passes" },
] as const;

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const t = new URL(request.url).searchParams.get("tab");
  const tab = TABS.some((x) => x.value === t) ? (t as (typeof TABS)[number]["value"]) : "action";
  const [placements, campaigns, passes] = await Promise.all([
    getPlacements(),
    tab === "passes" ? [] : adminCampaigns(tab as CampaignFilter),
    tab === "passes" ? adminPasses() : [],
  ]);
  return { tab, placements, campaigns, passes, today: today() };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  try {
    if (form.get("intent") === "pass") {
      await decideAdFree(str(form.get("passId")), form.get("decision") === "approve");
      return { ok: form.get("decision") === "approve" ? "Pass approved: banners are hidden for them now." : "Pass rejected." };
    }
    const c = await createExternalCampaign(form);
    throw redirect(`/admin/banners/${c.id}?created=1`);
  } catch (e) {
    if (e instanceof BannerError) return { error: e.message };
    throw e;
  }
}

export default function AdminBanners({ loaderData, actionData }: Route.ComponentProps) {
  const { tab, placements, campaigns, passes } = loaderData;
  const busy = useNavigation().state !== "idle";
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Banner ads"
        description="Banner bookings from members and outside advertisers, and ad-free passes. Ads only run after you approve them."
        actions={
          <Button asChild variant="outline">
            <Link to="/admin/banners/settings">Spots, prices & hero panel</Link>
          </Button>
        }
      />
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      {actionData && "ok" in actionData ? <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}

      <ExternalForm placements={placements} min={loaderData.today} busy={busy} />

      <div className="scrollbar-none flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <Link key={t.value} to={`?tab=${t.value}`} className={cn("shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold", tab === t.value ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70")}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "passes" ? (
        passes.length ? (
          <div className="grid gap-2">
            {passes.map((p) => (
              <Card key={p.id}>
                <CardContent className="flex flex-wrap items-center gap-3 pt-5 text-sm">
                  <span className="font-semibold">{p.number}</span>
                  <Link to={`/admin/users/${p.user.id}`} className="hover:underline">
                    {p.user.name}
                  </Link>
                  <span>
                    {p.days} days · {money(p.amountCents, "MWK")}
                  </span>
                  {p.paymentReference ? <span className="text-muted-foreground">Ref: {p.paymentReference}</span> : null}
                  {p.proofUrl ? (
                    <a href={p.proofUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                      Proof
                    </a>
                  ) : null}
                  <Badge variant={p.status === "approved" ? "success" : p.status === "rejected" ? "muted" : "highlight"}>{p.status.replace("_", " ")}</Badge>
                  {p.status === "requested" || p.status === "payment_submitted" ? (
                    <Form method="post" className="ml-auto flex gap-2">
                      <input type="hidden" name="intent" value="pass" />
                      <input type="hidden" name="passId" value={p.id} />
                      <Button type="submit" name="decision" value="approve" size="sm" disabled={busy}>
                        Payment received
                      </Button>
                      <Button type="submit" name="decision" value="reject" size="sm" variant="outline" disabled={busy}>
                        Reject
                      </Button>
                    </Form>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No ad-free pass requests yet.</p>
        )
      ) : campaigns.length ? (
        <div className="grid gap-2">
          {campaigns.map((c) => (
            <Link key={c.id} to={`/admin/banners/${c.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 text-sm transition-colors hover:border-primary/50">
              {c.creativeUrl ? <img src={c.creativeUrl} alt="" className="h-10 w-20 rounded object-cover" /> : <span className="flex h-10 w-20 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">no image</span>}
              <span className="grid">
                <span className="font-semibold">{c.title}</span>
                <span className="text-xs text-muted-foreground">
                  {c.number} · {c.placement.name} · {c.weeks}w · {c.advertiserId ? "member" : "non-member"}: {c.advertiserName}
                </span>
              </span>
              <span className="ml-auto flex items-center gap-2">
                {c.amountCents ? <span className="font-semibold">{money(c.amountCents, "MWK")}</span> : null}
                {c.status === "approved" && c.endsAt ? <span className="text-xs text-muted-foreground">to {date(c.endsAt)}</span> : null}
                <Badge variant={c.status === "approved" ? "success" : c.status === "rejected" || c.status === "cancelled" ? "muted" : "highlight"}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{tab === "action" ? "Nothing waiting for you." : "No banner ads here yet."}</p>
      )}
    </div>
  );
}

/** For advertisers without an account who got in touch by email or phone. */
function ExternalForm({ placements, min, busy }: { placements: Route.ComponentProps["loaderData"]["placements"]; min: string; busy: boolean }) {
  const [key, setKey] = useState(placements[0]?.key ?? "");
  const [weeks, setWeeks] = useState(1);
  const placement = placements.find((p) => p.key === key);
  return (
    <Card>
      <details>
        <summary className="cursor-pointer list-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlusIcon className="size-5" /> New ad for a non-member
            </CardTitle>
            <p className="text-sm text-muted-foreground">For someone who asked by email or phone. Upload their banner now, or send them an upload link with a passcode after saving.</p>
          </CardHeader>
        </summary>
        <CardContent>
          <Form method="post" encType="multipart/form-data" className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Contact name">
                <Input name="name" required />
              </Field>
              <Field label="Company (optional)">
                <Input name="company" />
              </Field>
              <Field label="Email">
                <Input name="email" type="email" required />
              </Field>
              <Field label="Phone (optional)">
                <Input name="phone" type="tel" />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Ad spot">
                <NativeSelect name="placement" value={key} onChange={(e) => setKey(e.target.value)}>
                  {placements.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name}
                      {p.isActive ? "" : " (off)"}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Weeks">
                <Input name="weeks" type="number" min={1} max={MAX_WEEKS} value={weeks} onChange={(e) => setWeeks(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
              <Field label="Start from">
                <Input name="start" type="date" min={min} />
              </Field>
              <Field label="Custom price" hint={placement ? `Standard: ${money(placement.weeklyCents * weeks, "MWK")}` : undefined}>
                <Input name="amount" inputMode="decimal" placeholder="leave empty for standard" />
              </Field>
            </div>
            <CreativeFields placement={placement} />
            <Field label="Notes (internal)">
              <Textarea name="notes" rows={2} />
            </Field>
            <Button type="submit" disabled={busy} className="justify-self-start">
              Save ad
            </Button>
          </Form>
        </CardContent>
      </details>
    </Card>
  );
}
