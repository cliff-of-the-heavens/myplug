import { Form, Link, useNavigation } from "react-router";
import { FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input, NativeSelect } from "~/components/ui/input";
import { requireAdmin } from "~/lib/auth.server";
import { NON_INTRUSIVE_POLICY } from "~/lib/banners";
import { BannerError, bannerSettings, getPlacements, saveBannerSettings, updatePlacement } from "~/lib/banners.server";
import { invalidate } from "~/lib/cache.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/admin.banner-settings";

export const meta: Route.MetaFunction = () => [{ title: "Banner settings · Admin · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const [placements, settings] = await Promise.all([getPlacements(), bannerSettings()]);
  return { placements, settings };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  try {
    if (form.get("intent") === "general") {
      await saveBannerSettings(form);
    } else {
      await updatePlacement(str(form.get("key")), form);
      invalidate("ad-placements");
    }
    return { ok: "Saved." };
  } catch (e) {
    if (e instanceof BannerError) return { error: e.message };
    throw e;
  }
}

export default function BannerSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { placements, settings } = loaderData;
  const busy = useNavigation().state !== "idle";
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Banner settings"
        description="Ad spots, their sizes and prices, what shows beside the home hero, and ad-free pricing."
        actions={
          <Button asChild variant="outline">
            <Link to="/admin/banners">Banner ads</Link>
          </Button>
        }
      />
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      {actionData && "ok" in actionData ? <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Home hero panel & pricing</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4">
            <input type="hidden" name="intent" value="general" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Beside the home hero" hint="Updates every 10 minutes">
                <NativeSelect name="heroPanel" defaultValue={settings.heroPanel}>
                  <option value="top_selling">Top 5 selling shops this week</option>
                  <option value="top_rated">Top 5 rated shops</option>
                  <option value="off">Nothing (full-width hero)</option>
                </NativeSelect>
              </Field>
              <Field label="Email for ad enquiries" hint="Shown to non-members on the Advertise page">
                <Input name="adsEmail" type="email" defaultValue={settings.adsEmail} />
              </Field>
              <Field label="Ad-free price per 30 days (MWK)" hint="3 months: 10% off · 1 year: 2 months free">
                <Input name="adFreePrice" inputMode="decimal" defaultValue={String(settings.adFreeCents / 100)} />
              </Field>
            </div>
            <Button type="submit" disabled={busy} className="justify-self-start">
              Save
            </Button>
          </Form>
        </CardContent>
      </Card>

      <p className="rounded-xl bg-secondary/60 p-3 text-sm">{NON_INTRUSIVE_POLICY}</p>

      {placements.map((p) => (
        <Card key={p.key}>
          <CardHeader>
            <CardTitle>{p.name}</CardTitle>
            <p className="text-sm text-muted-foreground">{p.description}</p>
          </CardHeader>
          <CardContent>
            <Form method="post" className="grid gap-4">
              <input type="hidden" name="key" value={p.key} />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <Field label="Width (px)">
                  <Input name="width" type="number" defaultValue={p.width} />
                </Field>
                <Field label="Height (px)">
                  <Input name="height" type="number" defaultValue={p.height} />
                </Field>
                <Field label="Max file (KB)">
                  <Input name="maxKb" type="number" defaultValue={p.maxKb} />
                </Field>
                <Field label="Ads at once">
                  <Input name="maxActive" type="number" min={1} max={20} defaultValue={p.maxActive} />
                </Field>
                <Field label="Weekly price (MWK)">
                  <Input name="weekly" inputMode="decimal" defaultValue={String(p.weeklyCents / 100)} />
                </Field>
              </div>
              <div className="flex flex-wrap gap-6 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="isActive" defaultChecked={p.isActive} className="size-4 accent-primary" /> On sale and showing
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="hideable" defaultChecked={p.hideableWithPass} className="size-4 accent-primary" /> Hidden for ad-free pass holders
                </label>
              </div>
              <Button type="submit" variant="outline" disabled={busy} className="justify-self-start">
                Save {p.name}
              </Button>
            </Form>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
