import { useState } from "react";
import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { DateTimeField } from "~/components/datetime-field";
import { ImageDropzone } from "~/components/image-dropzone";
import { Container, FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Field, Input, Textarea } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import type { TransportType } from "~/db/schema";
import { eq } from "drizzle-orm";
import { requireCustomer } from "~/lib/auth.server";
import { isDateStr, today } from "~/lib/dates";
import { parseMoney } from "~/lib/format";
import { isTransportType, TRANSPORT_TYPES } from "~/lib/transport";
import { createJob, TransportError } from "~/lib/transport.server";
import { uploadImage, UploadError } from "~/lib/upload.server";
import { cn, str } from "~/lib/utils";
import type { Route } from "./+types/transport.new";

export const meta: Route.MetaFunction = () => [{ title: "Request transport · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  const me = await db.query.users.findFirst({ where: eq(schema.users.id, user.id), columns: { phone: true } });
  return { phone: me?.phone ?? "", today: today() };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const form = await request.formData();
  const type = str(form.get("type"));
  if (!isTransportType(type)) return { error: "Choose what you need." };
  let when: Date | null = null;
  let untilDate: string | null = null;
  if (type === "car_hire") {
    const start = str(form.get("startDate"));
    const end = str(form.get("untilDate"));
    if (!isDateStr(start) || !isDateStr(end)) return { error: "Choose the first and last day you need the car." };
    when = new Date(`${start}T12:00:00Z`); // midday, so the day reads the same in any time zone
    untilDate = end;
  } else if (form.get("timing") === "later") {
    when = new Date(str(form.get("when")));
    if (Number.isNaN(when.getTime())) return { error: "Choose the date and time." };
  }
  let imageUrl: string | null = null;
  try {
    imageUrl = type === "moving" || type === "parcel" ? await uploadImage(form.get("image"), "transport") : null;
    const passengers = Number(form.get("passengers")) || null;
    const job = await createJob(user.id, {
      type,
      pickup: str(form.get("pickup")),
      dropoff: str(form.get("dropoff")),
      when,
      untilDate,
      passengers: passengers && passengers > 0 && passengers < 100 ? passengers : null,
      details: str(form.get("details")),
      budgetCents: str(form.get("budget")) ? parseMoney(form.get("budget")) : null,
      contactPhone: str(form.get("contactPhone")),
      imageUrl,
    });
    return redirect(`/transport/jobs/${job.id}`);
  } catch (e) {
    if (e instanceof TransportError || e instanceof UploadError) return { error: e.message };
    throw e;
  }
}

const COPY: Record<TransportType, { pickup: string; dropoff?: string; details: string; detailsHint: string }> = {
  taxi: { pickup: "Pick me up at", dropoff: "Going to", details: "Anything the driver should know (optional)", detailsHint: "e.g. 2 suitcases, child seat needed" },
  moving: { pickup: "Moving from", dropoff: "Moving to", details: "What's moving?", detailsHint: "e.g. 2-bedroom house: beds, sofa, fridge, about 20 boxes. Need 2 helpers to carry." },
  parcel: { pickup: "Collect from", dropoff: "Deliver to", details: "What's being sent?", detailsHint: "e.g. a bag of documents; a 2-door fridge" },
  car_hire: { pickup: "Where you'd like to collect the car", details: "What kind of car? (optional)", detailsHint: "e.g. 4x4 for a trip to Nyika, automatic, with a driver" },
};

export default function NewTransport({ loaderData, actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const initial = params.get("type");
  const [type, setType] = useState<TransportType>(isTransportType(initial) ? initial : "taxi");
  const [later, setLater] = useState(type === "moving");
  const busy = useNavigation().state !== "idle";
  const copy = COPY[type];

  return (
    <Container className="max-w-2xl py-8">
      <Link to="/transport" className="mb-3 block w-fit text-sm text-muted-foreground hover:text-primary">
        ← Transport
      </Link>
      <PageHeader title="Request transport" description="Registered couriers and drivers who offer this are told straight away and send you their price. You choose one." />
      <Card>
        <CardContent className="pt-5">
          <Form method="post" encType="multipart/form-data" className="grid gap-5">
            <FormError error={actionData?.error} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TRANSPORT_TYPES.map((t) => (
                <label
                  key={t.value}
                  className={cn(
                    "cursor-pointer rounded-xl border-2 p-3 text-center text-sm font-semibold transition-colors",
                    type === t.value ? "border-primary bg-primary/5 text-primary" : "hover:border-primary/40",
                  )}
                >
                  <input type="radio" name="type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} className="sr-only" />
                  {t.short}
                </label>
              ))}
            </div>

            <Field label={copy.pickup}>
              <Input name="pickup" required maxLength={200} placeholder="Area and town, e.g. Area 47, Lilongwe" />
            </Field>
            {copy.dropoff ? (
              <Field label={copy.dropoff}>
                <Input name="dropoff" required maxLength={200} placeholder="e.g. Kamuzu International Airport" />
              </Field>
            ) : null}

            {type === "car_hire" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First day">
                  <Input name="startDate" type="date" min={loaderData.today} required />
                </Field>
                <Field label="Last day">
                  <Input name="untilDate" type="date" min={loaderData.today} required />
                </Field>
              </div>
            ) : (
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-semibold">When?</legend>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      [false, "As soon as possible"],
                      [true, "Choose a time"],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={label}
                      className={cn("cursor-pointer rounded-full border-2 px-4 py-1.5 text-sm font-semibold", later === value ? "border-primary bg-primary/5 text-primary" : "hover:border-primary/40")}
                    >
                      <input type="radio" name="timing" value={value ? "later" : "now"} checked={later === value} onChange={() => setLater(value)} className="sr-only" />
                      {label}
                    </label>
                  ))}
                </div>
                {later ? <DateTimeField name="when" required className="max-w-64" /> : null}
              </fieldset>
            )}

            {type === "taxi" || type === "car_hire" ? (
              <Field label="Passengers" className="max-w-40">
                <Input name="passengers" type="number" min={1} max={60} defaultValue={1} />
              </Field>
            ) : null}

            <Field label={copy.details} hint={copy.detailsHint}>
              <Textarea name="details" rows={3} required={type === "moving" || type === "parcel"} />
            </Field>
            {type === "moving" || type === "parcel" ? (
              <Field label="Photo (optional)" hint="Helps couriers bring the right vehicle">
                <ImageDropzone prompt="Add a photo" className="min-h-32" imgClassName="max-h-60 w-full object-contain" />
              </Field>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Your budget (optional)">
                <Input name="budget" inputMode="decimal" placeholder="MK 20,000" />
              </Field>
              <Field label="Phone number" hint="Only given to the courier you choose">
                <Input name="contactPhone" type="tel" required defaultValue={loaderData.phone} />
              </Field>
            </div>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "Sending..." : "Send request"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </Container>
  );
}
