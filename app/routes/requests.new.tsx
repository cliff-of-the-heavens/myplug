import { useState } from "react";
import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { ImageDropzone } from "~/components/image-dropzone";
import { Container, FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { requireCustomer } from "~/lib/auth.server";
import { getCategories } from "~/lib/catalog.server";
import { HANDYMAN_GROUP } from "~/lib/handyman";
import { notifyTradespeople } from "~/lib/jobs.server";
import { parseMoney } from "~/lib/format";
import { uploadImage, UploadError } from "~/lib/upload.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/requests.new";

export const meta: Route.MetaFunction = () => [{ title: "Post a request · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireCustomer(request);
  return { trades: (await getCategories()).filter((c) => c.group === HANDYMAN_GROUP).map((c) => ({ id: c.id, slug: c.slug, name: c.name })) };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const form = await request.formData();
  const title = str(form.get("title"));
  const description = str(form.get("description"));
  if (title.length < 3) return { error: "Give your request a short title." };
  if (description.length < 10) return { error: "Describe what you're looking for (at least 10 characters)." };
  // A job for handymen: the trade it needs and where the work is
  const trade = (await getCategories()).find((c) => c.group === HANDYMAN_GROUP && c.slug === str(form.get("trade")));
  const location = str(form.get("location")).slice(0, 200);
  if (trade && location.length < 2) return { error: "Say where the job is, so handymen nearby can quote." };

  let imageUrl: string | null;
  try {
    imageUrl = await uploadImage(form.get("image"), "requests");
  } catch (e) {
    if (e instanceof UploadError) return { error: e.message };
    throw e;
  }
  // Not every job can be photographed (e.g. a garden to clear), so jobs may skip the photo.
  if (!imageUrl && !trade) return { error: "Add a photo so merchants can see what you mean." };

  const [created] = await db
    .insert(schema.requests)
    .values({
      customerId: user.id,
      title: title.slice(0, 120),
      description: description.slice(0, 2000),
      imageUrl,
      budgetCents: str(form.get("budget")) ? parseMoney(form.get("budget")) : null,
      categoryId: trade?.id ?? null,
      location: trade ? location : null,
    })
    .returning({ id: schema.requests.id });

  if (trade) await notifyTradespeople({ id: created.id, title, location, tradeSlug: trade.slug, tradeName: trade.name });

  return redirect(`/requests/${created.id}`);
}

export default function NewRequest({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const [params] = useSearchParams();
  const { trades } = loaderData;
  const [trade, setTrade] = useState(trades.some((t) => t.slug === params.get("trade")) ? params.get("trade")! : "");

  return (
    <Container className="max-w-2xl py-8">
      <PageHeader
        title={trade ? "Post a job" : "Post a request"}
        description={
          trade
            ? "Describe what needs doing. Handymen in that trade are told straight away and message you with quotes."
            : "Show merchants what you want. They'll message you directly with offers."
        }
      />
      <Card>
        <CardContent className="pt-5">
          <Form method="post" encType="multipart/form-data" className="grid gap-5">
            <FormError error={actionData?.error} />
            <Field label="Is this a job for a handyman?" hint="Choose a trade and the handymen in it are sent your job">
              <NativeSelect name="trade" value={trade} onChange={(e) => setTrade(e.target.value)}>
                <option value="">No, I'm looking for an item</option>
                {trades.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <ImageDropzone
              required={!trade}
              capture="environment"
              prompt={trade ? "Add a photo of the problem (optional)" : "Tap to add a photo, or drag one here"}
              hint="JPG, PNG, WebP or GIF up to 4 MB"
              className="min-h-48"
              imgClassName="max-h-80 w-full object-contain"
            />
            <Field label={trade ? "What needs doing?" : "What are you looking for?"}>
              <Input name="title" required maxLength={120} placeholder={trade ? "e.g. Fridge stopped cooling" : "e.g. Custom birthday cake like this"} />
            </Field>
            <Field label="Details">
              <Textarea
                name="description"
                required
                rows={4}
                placeholder={trade ? "Make and model, what happened, when you'd like it done..." : "Size, colour, quantity, when you need it..."}
              />
            </Field>
            {trade ? (
              <Field label="Where is the job?" hint="Area and town is enough; share the exact address only with the handyman you choose">
                <Input name="location" required maxLength={200} placeholder="e.g. Area 47, Lilongwe" />
              </Field>
            ) : null}
            <Field label="Budget (optional)" hint={trade ? "Helps handymen know what you expect to pay" : "Helps merchants know if they can help"}>
              <Input name="budget" inputMode="decimal" placeholder="MK 50,000" />
            </Field>
            <p className="text-xs text-muted-foreground">
              Only post images you own or have permission to share. Images that break our{" "}
              <Link to="/safety" className="underline">community guidelines</Link> will be removed.
            </p>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "Posting..." : trade ? "Post job" : "Post request"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </Container>
  );
}
