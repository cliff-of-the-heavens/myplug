import { PlusIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { ImageDropzone, PROOF_TYPES } from "~/components/image-dropzone";
import { Container, FormError, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "~/components/ui/input";
import { TRANSPORT_TYPES, VEHICLE_TYPES } from "~/lib/transport";
import { requireCourier } from "~/lib/auth.server";
import { CourierError, courierFromForm, getCourier, saveProfile, saveRates } from "~/lib/couriers.server";
import { uploadPrivate, UploadError } from "~/lib/upload.server";
import type { Route } from "./+types/courier.profile";

export const meta: Route.MetaFunction = () => [{ title: "Courier profile · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCourier(request);
  return { courier: (await getCourier(user.courierId))! };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCourier(request);
  const form = await request.formData();
  try {
    if (form.get("intent") === "rates") {
      const n = await saveRates(user.courierId, form);
      return { ok: `Saved prices for ${n} area${n === 1 ? "" : "s"}.` };
    }
    const status = await saveProfile(user.courierId, {
      ...courierFromForm(form),
      facePhotoKey: await uploadPrivate(form.get("facePhoto"), "couriers"),
      idDocumentKey: await uploadPrivate(form.get("idDocument"), "couriers", { documents: true }),
    });
    return { ok: status === "pending" ? "Saved. An admin will review your details." : "Profile saved." };
  } catch (e) {
    if (e instanceof CourierError || e instanceof UploadError) return { error: e.message };
    throw e;
  }
}

const STATUS_TONE = { pending: "warning", approved: "success", rejected: "destructive", suspended: "destructive" } as const;

export default function CourierProfile({ loaderData, actionData }: Route.ComponentProps) {
  const { courier } = loaderData;
  const busy = useNavigation().state !== "idle";
  const [rates, setRates] = useState(
    courier.rates.length ? courier.rates.map((r) => ({ area: r.area, price: String(r.estimateCents / 100) })) : [{ area: "", price: "" }],
  );

  return (
    <Container className="max-w-3xl py-8">
      <PageHeader
        title="Courier profile"
        description={
          <span className="flex items-center gap-2">
            Status: <Badge variant={STATUS_TONE[courier.status]} className="capitalize">{courier.status}</Badge>
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link to="/courier">Dashboard</Link>
          </Button>
        }
      />
      {actionData && "ok" in actionData ? (
        <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p>
      ) : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      {courier.reviewNote ? <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm">Note from MyPlug: {courier.reviewNote}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" encType="multipart/form-data" className="grid gap-4">
            <p className="flex gap-2 rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">
              <ShieldCheckIcon className="size-4 shrink-0 text-success" />
              Stores see your face photo when you collect, so they can check it's you. Your ID document is only seen by
              MyPlug staff. Changing these sends your account for review again.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Clear photo of your face" hint={courier.facePhotoKey ? "Uploaded. Add a new one to replace it." : "Required"}>
                <ImageDropzone
                  name="facePhoto"
                  capture="user"
                  defaultPreview={courier.facePhotoKey ? `/files/courier/${courier.id}?which=face` : null}
                  prompt="Add face photo"
                  className="aspect-square max-w-56"
                />
              </Field>
              <Field label="National ID or driving licence" hint={courier.idDocumentKey ? "Uploaded. Add a new one to replace it." : "Required: photo or PDF"}>
                <ImageDropzone
                  name="idDocument"
                  types={PROOF_TYPES}
                  prompt="Add ID document"
                  className="aspect-square max-w-56"
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name or courier company">
                <Input name="name" defaultValue={courier.name} required />
              </Field>
              <Field label="Phone">
                <Input name="phone" type="tel" defaultValue={courier.phone} required />
              </Field>
              <Field label="National ID number">
                <Input name="nationalIdNumber" defaultValue={courier.nationalIdNumber ?? ""} required />
              </Field>
              <Field label="Vehicle">
                <Input name="vehicle" defaultValue={courier.vehicle ?? ""} placeholder="Motorbike, car, bicycle..." />
              </Field>
              <Field label="Number plate">
                <Input name="plateNumber" defaultValue={courier.plateNumber ?? ""} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Vehicle type">
                <NativeSelect name="vehicleType" defaultValue={courier.vehicleType ?? ""}>
                  <option value="">Choose...</option>
                  {VEHICLE_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Capacity (optional)">
                <Input name="capacity" defaultValue={courier.capacity ?? ""} placeholder="e.g. 4 passengers, 3-tonne truck" />
              </Field>
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-semibold">Besides store deliveries, I also offer</legend>
              <p className="-mt-1 text-xs text-muted-foreground">You're told about customer requests for these, and can send your price.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {TRANSPORT_TYPES.map((t) => (
                  <label key={t.value} className="flex items-start gap-2 rounded-xl border p-3 text-sm">
                    <input type="checkbox" name="services" value={t.value} defaultChecked={courier.services.includes(t.value)} className="mt-0.5 size-4 accent-primary" />
                    <span className="grid">
                      <span className="font-semibold">{t.short}</span>
                      <span className="text-xs text-muted-foreground">{t.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="About you (optional)">
              <Textarea name="bio" rows={2} defaultValue={courier.bio ?? ""} className="min-h-0" placeholder="Areas you know, hours you work..." />
            </Field>
            <Button type="submit" disabled={busy} className="justify-self-start">
              Save profile
            </Button>
          </Form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Areas and estimated prices</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-3">
            <input type="hidden" name="intent" value="rates" />
            <p className="text-sm text-muted-foreground">
              Customers see these estimates when choosing couriers. You confirm the actual price when a request comes in.
              Use an area (e.g. "Area 47") or a whole city (e.g. "Lilongwe").
            </p>
            {rates.map((r, i) => (
              <div key={i} className="flex gap-2">
                <Input name="area" placeholder="Area or city" defaultValue={r.area} className="flex-1" />
                <Input name="price" inputMode="decimal" placeholder="Price (MK)" defaultValue={r.price} className="w-36" />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setRates((l) => l.filter((_, j) => j !== i))}>
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setRates((l) => [...l, { area: "", price: "" }])}>
                <PlusIcon /> Add area
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                Save prices
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </Container>
  );
}
