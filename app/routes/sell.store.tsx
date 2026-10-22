import { useState } from "react";
import { eq } from "drizzle-orm";
import { ExternalLinkIcon } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import { FormError, PageHeader } from "~/components/page";
import { ImageDropzone } from "~/components/image-dropzone";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "~/components/ui/input";
import { storeDeliveryMode, type StoreDeliveryMode } from "~/db/schema";
import { availableCouriers } from "~/lib/delivery.server";
import { db, schema } from "~/db/client.server";
import { requireMerchant } from "~/lib/auth.server";
import { currencyName } from "~/lib/format";
import { uploadImage, UploadError } from "~/lib/upload.server";
import { cn, isUuid, str } from "~/lib/utils";
import type { Route } from "./+types/sell.store";

export const meta: Route.MetaFunction = () => [{ title: "Store settings · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const [store, couriers] = await Promise.all([
    db.query.stores.findFirst({ where: eq(schema.stores.id, user.storeId) }),
    availableCouriers(),
  ]);
  return { store: store!, couriers };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireMerchant(request);
  const form = await request.formData();
  const name = str(form.get("name"));
  if (name.length < 2) return { error: "Store name is too short." };
  const deliveryMode = str(form.get("deliveryMode")) as StoreDeliveryMode;
  if (!storeDeliveryMode.enumValues.includes(deliveryMode)) return { error: "Choose who delivers your orders." };
  const courierId = str(form.get("preferredCourierId"));
  if (deliveryMode === "merchant_courier" && !isUuid(courierId)) return { error: "Choose the courier who delivers for you." };
  const pickupAddress = str(form.get("pickupAddress")).slice(0, 300);
  if (deliveryMode !== "merchant" && pickupAddress.length < 5) return { error: "Add the address couriers and customers collect from." };

  let logoUrl: string | null;
  try {
    logoUrl = await uploadImage(form.get("logo"), "logos");
  } catch (e) {
    if (e instanceof UploadError) return { error: e.message };
    throw e;
  }
  await db
    .update(schema.stores)
    .set({
      name,
      description: str(form.get("description")) || null,
      deliveryMode,
      preferredCourierId: deliveryMode === "merchant_courier" ? courierId : null,
      pickupAddress: pickupAddress || null,
      ...(logoUrl ? { logoUrl } : {}),
    })
    .where(eq(schema.stores.id, user.storeId));
  return { ok: true };
}

export default function StoreSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { store, couriers } = loaderData;
  const busy = useNavigation().state !== "idle";
  const [mode, setMode] = useState<StoreDeliveryMode>(store.deliveryMode);
  return (
    <>
      <PageHeader
        title="Store settings"
        actions={
          <Button asChild variant="outline">
            <Link to={`/s/${store.slug}`}>
              <ExternalLinkIcon /> View store
            </Link>
          </Button>
        }
      />
      <Card className="max-w-2xl">
        <CardContent className="pt-5">
          <Form method="post" encType="multipart/form-data" className="grid gap-4">
            <FormError error={actionData && "error" in actionData ? actionData.error : null} />
            {actionData && "ok" in actionData ? <p className="text-sm font-medium text-success">Saved!</p> : null}
            <Field label="Logo">
              <ImageDropzone
                name="logo"
                defaultPreview={store.logoUrl}
                prompt="Add logo"
                hint="Drag & drop or click"
                className="size-36"
              />
            </Field>
            <Field label="Store name">
              <Input name="name" required defaultValue={store.name} />
            </Field>
            <Field label="About your store">
              <Textarea name="description" rows={4} defaultValue={store.description ?? ""} />
            </Field>
            <p className="rounded-lg bg-muted px-3 py-2 text-sm">
              Currency: <strong>{currencyName(store.currency)}</strong>. Set by MyPlug; contact support to change it.
            </p>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-semibold">Who delivers your orders?</legend>
              {(
                [
                  ["merchant", "We deliver ourselves", "Your own staff or vehicle. You update the order as it goes."],
                  ["merchant_courier", "Our courier delivers", "A courier you choose collects each order. You pay them."],
                  ["customer", "The customer arranges it", "They collect, or choose and pay a courier. You check who collects."],
                ] as const
              ).map(([value, label, text]) => (
                <label key={value} className={cn("flex cursor-pointer gap-2 rounded-xl border-2 p-3 text-sm", mode === value ? "border-primary bg-primary/5" : "hover:border-primary/40")}>
                  <input type="radio" name="deliveryMode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-0.5 accent-primary" />
                  <span className="grid">
                    <span className="font-semibold">{label}</span>
                    <span className="text-xs text-muted-foreground">{text}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {mode === "merchant_courier" ? (
              <Field label="Your courier" hint="They're asked to confirm each order's delivery once you confirm the order">
                <NativeSelect name="preferredCourierId" defaultValue={store.preferredCourierId ?? ""} required>
                  <option value="" disabled>Choose a registered courier</option>
                  {couriers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.vehicle ? ` (${c.vehicle})` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            {mode !== "merchant" ? (
              <Field label="Pickup address" hint="Shown to couriers and collectors">
                <Textarea name="pickupAddress" rows={2} defaultValue={store.pickupAddress ?? ""} required className="min-h-0" />
              </Field>
            ) : null}
            <p className="text-xs text-muted-foreground">Store link: /s/{store.slug}</p>
            <Button type="submit" disabled={busy} className="justify-self-start">
              {busy ? "Saving..." : "Save"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </>
  );
}
