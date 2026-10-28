import { useState } from "react";
import { and, eq } from "drizzle-orm";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import { GalleryField } from "~/components/gallery-field";
import { ImageDropzone } from "~/components/image-dropzone";
import { Container, FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { requireCourier } from "~/lib/auth.server";
import { parseMoney } from "~/lib/format";
import { isOwnUpload } from "~/lib/storage.server";
import { saveCar, TransportError } from "~/lib/transport.server";
import { uploadImage, UploadError } from "~/lib/upload.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/courier.car-form";

export const meta: Route.MetaFunction = () => [{ title: "Hire car · MyPlug" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireCourier(request);
  if (!params.id) return { car: null };
  const car = await db.query.hireCars.findFirst({ where: and(eq(schema.hireCars.id, params.id), eq(schema.hireCars.courierId, user.courierId)) });
  if (!car) throw data("Car not found", { status: 404 });
  return { car };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireCourier(request);
  const form = await request.formData();
  try {
    // Extra photos were uploaded one by one; keep only files we stored.
    const images: string[] = [];
    for (const url of form.getAll("gallery").map(String).slice(0, 8)) if (await isOwnUpload(url)) images.push(url);
    const offerDriver = form.get("offerDriver") === "on";
    await saveCar(
      user.courierId,
      {
        title: str(form.get("title")),
        description: str(form.get("description")),
        seats: Number(form.get("seats")),
        transmission: form.get("transmission") === "manual" ? "manual" : form.get("transmission") === "automatic" ? "automatic" : null,
        dailyCents: parseMoney(form.get("daily")),
        selfDrive: form.get("selfDrive") === "on",
        driverDailyCents: offerDriver ? (parseMoney(form.get("driverDaily")) ?? 0) : null,
        location: str(form.get("location")),
        imageUrl: await uploadImage(form.get("image"), "cars"),
        images,
        isActive: form.get("isActive") === "on",
      },
      params.id,
    );
  } catch (e) {
    if (e instanceof TransportError || e instanceof UploadError) return { error: e.message };
    throw e;
  }
  return redirect("/courier/cars");
}

export default function CarForm({ loaderData, actionData }: Route.ComponentProps) {
  const { car } = loaderData;
  const busy = useNavigation().state !== "idle";
  const [offerDriver, setOfferDriver] = useState(car ? car.driverDailyCents != null : false);
  return (
    <Container className="max-w-3xl py-8">
      <Link to="/courier/cars" className="mb-3 block w-fit text-sm text-muted-foreground hover:text-primary">
        ← Hire cars
      </Link>
      <PageHeader title={car ? `Edit ${car.title}` : "Add a hire car"} />
      <Card>
        <CardContent className="pt-5">
          <Form method="post" encType="multipart/form-data" className="grid gap-5 md:grid-cols-[14rem_1fr]">
            <div className="grid content-start gap-2">
              <ImageDropzone defaultPreview={car?.imageUrl} prompt="Main photo" className="aspect-[4/3]" />
            </div>
            <div className="grid content-start gap-4">
              <FormError error={actionData?.error} />
              <Field label="Car">
                <Input name="title" required defaultValue={car?.title} placeholder="e.g. 2016 Toyota Axio" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Seats">
                  <Input name="seats" type="number" min={1} max={60} required defaultValue={car?.seats ?? 5} />
                </Field>
                <Field label="Gearbox">
                  <NativeSelect name="transmission" defaultValue={car?.transmission ?? ""}>
                    <option value="">Not given</option>
                    <option value="automatic">Automatic</option>
                    <option value="manual">Manual</option>
                  </NativeSelect>
                </Field>
                <Field label="Price per day (MK)">
                  <Input name="daily" inputMode="decimal" required defaultValue={car ? String(car.dailyCents / 100) : ""} />
                </Field>
              </div>
              <Field label="Collected at">
                <Input name="location" required defaultValue={car?.location} placeholder="e.g. Area 3 Shell garage, Lilongwe" />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="selfDrive" defaultChecked={car ? car.selfDrive : true} className="size-4 accent-primary" />
                Can be hired without a driver (self-drive)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="offerDriver" checked={offerDriver} onChange={(e) => setOfferDriver(e.target.checked)} className="size-4 accent-primary" />
                I can provide a driver
              </label>
              {offerDriver ? (
                <Field label="Extra per day for the driver (MK)" className="max-w-56">
                  <Input name="driverDaily" inputMode="decimal" defaultValue={car?.driverDailyCents != null ? String(car.driverDailyCents / 100) : ""} />
                </Field>
              ) : null}
              <Field label="Details" hint="Fuel policy, deposit, mileage limits, what licence you need to see">
                <Textarea name="description" rows={4} defaultValue={car?.description} />
              </Field>
              <Field label="More photos">
                <GalleryField initial={car?.images ?? []} max={8} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isActive" defaultChecked={car ? car.isActive : true} className="size-4 accent-primary" />
                Show to customers
              </label>
              <Button type="submit" disabled={busy} className="justify-self-start">
                {busy ? "Saving..." : "Save car"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </Container>
  );
}
