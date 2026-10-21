import { Form, Link, redirect, useNavigation } from "react-router";
import { ImageDropzone } from "~/components/image-dropzone";
import { Container, FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Field, Input, Textarea } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { requireCustomer } from "~/lib/auth.server";
import { parseMoney } from "~/lib/format";
import { uploadImage, UploadError } from "~/lib/upload.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/requests.new";

export const meta: Route.MetaFunction = () => [{ title: "Post a request · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireCustomer(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const form = await request.formData();
  const title = str(form.get("title"));
  const description = str(form.get("description"));
  if (title.length < 3) return { error: "Give your request a short title." };
  if (description.length < 10) return { error: "Describe what you're looking for (at least 10 characters)." };

  let imageUrl: string | null;
  try {
    imageUrl = await uploadImage(form.get("image"), "requests");
  } catch (e) {
    if (e instanceof UploadError) return { error: e.message };
    throw e;
  }
  if (!imageUrl) return { error: "Add a photo so merchants can see what you mean." };

  const [created] = await db
    .insert(schema.requests)
    .values({
      customerId: user.id,
      title: title.slice(0, 120),
      description: description.slice(0, 2000),
      imageUrl,
      budgetCents: str(form.get("budget")) ? parseMoney(form.get("budget")) : null,
    })
    .returning({ id: schema.requests.id });

  return redirect(`/requests/${created.id}`);
}

export default function NewRequest({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";

  return (
    <Container className="max-w-2xl py-8">
      <PageHeader
        title="Post a request"
        description="Show merchants what you want. They'll message you directly with offers."
      />
      <Card>
        <CardContent className="pt-5">
          <Form method="post" encType="multipart/form-data" className="grid gap-5">
            <FormError error={actionData?.error} />
            <ImageDropzone
              required
              capture="environment"
              prompt="Tap to add a photo, or drag one here"
              hint="JPG, PNG, WebP or GIF up to 4 MB"
              className="min-h-48"
              imgClassName="max-h-80 w-full object-contain"
            />
            <Field label="What are you looking for?">
              <Input name="title" required maxLength={120} placeholder="e.g. Custom birthday cake like this" />
            </Field>
            <Field label="Details">
              <Textarea name="description" required rows={4} placeholder="Size, colour, quantity, when you need it..." />
            </Field>
            <Field label="Budget (optional)" hint="Helps merchants know if they can help">
              <Input name="budget" inputMode="decimal" placeholder="MK 50,000" />
            </Field>
            <p className="text-xs text-muted-foreground">
              Only post images you own or have permission to share. Images that break our{" "}
              <Link to="/safety" className="underline">community guidelines</Link> will be removed.
            </p>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "Posting..." : "Post request"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </Container>
  );
}
