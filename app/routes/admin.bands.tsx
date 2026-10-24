import { Form, Link, useNavigation } from "react-router";
import { FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input } from "~/components/ui/input";
import { requireAdmin } from "~/lib/auth.server";
import { PHOTO_LIMITS } from "~/lib/bands";
import { adminBandRequests, BandError, decideBandRequest, listBands, maxPhotos, saveBand, saveMaxPhotos } from "~/lib/bands.server";
import { date, money } from "~/lib/format";
import { str } from "~/lib/utils";
import type { Route } from "./+types/admin.bands";

export const meta: Route.MetaFunction = () => [{ title: "Listing plans · Admin · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const [bands, requests, photos] = await Promise.all([listBands(), adminBandRequests(), maxPhotos()]);
  return { bands, requests, photos };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  try {
    switch (form.get("intent")) {
      case "band":
        await saveBand(form);
        return { ok: "Plan saved." };
      case "photos":
        await saveMaxPhotos(Number(form.get("photos")));
        return { ok: "Saved. The listing form uses the new limit straight away." };
      case "decide":
        await decideBandRequest(str(form.get("requestId")), form.get("decision") === "approve", String(form.get("note") ?? ""));
        return { ok: form.get("decision") === "approve" ? "Approved: the store is on its new plan." : "Rejected. The merchant was told." };
    }
  } catch (e) {
    if (e instanceof BandError) return { error: e.message };
    throw e;
  }
  return { error: "Unknown action." };
}

function BandForm({ b, busy }: { b?: Route.ComponentProps["loaderData"]["bands"][number]; busy: boolean }) {
  return (
    <Form method="post" className="grid items-end gap-3 sm:grid-cols-[1fr_8rem_9rem_5rem_auto]">
      <input type="hidden" name="intent" value="band" />
      {b ? <input type="hidden" name="id" value={b.id} /> : null}
      <Field label="Plan name">
        <Input name="name" required defaultValue={b?.name ?? ""} placeholder="e.g. Growth" />
      </Field>
      <Field label="Items allowed" hint="Empty = unlimited">
        <Input name="maxItems" type="number" min={1} defaultValue={b?.maxItems ?? ""} />
      </Field>
      <Field label="Monthly (MWK)">
        <Input name="monthly" inputMode="decimal" defaultValue={b ? String(b.monthlyCents / 100) : ""} placeholder="0 = free" />
      </Field>
      <Field label="Order">
        <Input name="position" type="number" defaultValue={b?.position ?? 0} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 pb-2 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="isActive" defaultChecked={b?.isActive ?? true} className="size-4 accent-primary" /> On sale
        </label>
        <label className="flex items-center gap-1.5" title="What every store gets without paying (must be free)">
          <input type="checkbox" name="isDefault" defaultChecked={b?.isDefault ?? false} className="size-4 accent-primary" /> Default
        </label>
        <Button type="submit" size="sm" variant={b ? "outline" : "default"} disabled={busy}>
          {b ? "Save" : "Add plan"}
        </Button>
      </div>
    </Form>
  );
}

export default function AdminBands({ loaderData, actionData }: Route.ComponentProps) {
  const { bands, requests, photos } = loaderData;
  const busy = useNavigation().state !== "idle";
  return (
    <div className="grid gap-6">
      <PageHeader title="Listing plans" description="How many items each store can list, what bigger plans cost, and how many photos a listing can have." />
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      {actionData && "ok" in actionData ? <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}

      {requests.length ? (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>Plan requests</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {requests.map((r) => (
              <Form key={r.id} method="post" className="flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm">
                <input type="hidden" name="intent" value="decide" />
                <input type="hidden" name="requestId" value={r.id} />
                <span className="font-semibold">{r.number}</span>
                <Link to={`/s/${r.store.slug}`} className="hover:underline">
                  {r.store.name}
                </Link>
                <span>
                  → {r.band.name}, {r.months} month{r.months > 1 ? "s" : ""}, {money(r.amountCents, "MWK")}
                </span>
                <span className="text-muted-foreground">{r.status === "payment_submitted" ? `Paid: ${r.paymentReference ?? "proof attached"}` : "Not paid yet"}</span>
                {r.proofUrl ? (
                  <a href={r.proofUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                    Proof
                  </a>
                ) : null}
                <span className="text-xs text-muted-foreground">{date(r.createdAt)}</span>
                <Input name="note" placeholder="Note (optional)" className="ml-auto w-48" />
                <Button type="submit" name="decision" value="approve" size="sm" disabled={busy}>
                  Payment received
                </Button>
                <Button type="submit" name="decision" value="reject" size="sm" variant="outline" disabled={busy}>
                  Reject
                </Button>
              </Form>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
          <p className="text-sm text-muted-foreground">
            Exactly one free plan is the default. When a paid plan runs out, the store goes back to the default: existing listings stay, but it
            can't add more beyond the limit. Archived listings don't count. Set a store's plan directly under Merchants.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4">
          {bands.map((b) => (
            <BandForm key={b.id} b={b} busy={busy} />
          ))}
          <div className="border-t pt-4">
            <p className="mb-2 text-sm font-semibold">New plan</p>
            <BandForm busy={busy} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photos per listing</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="photos" />
            <Field label="Extra photos allowed (besides the main photo)" hint={`${PHOTO_LIMITS.min}–${PHOTO_LIMITS.max}. Houses get this many interior and this many exterior photos.`}>
              <Input name="photos" type="number" min={PHOTO_LIMITS.min} max={PHOTO_LIMITS.max} defaultValue={photos} className="w-28" />
            </Field>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
