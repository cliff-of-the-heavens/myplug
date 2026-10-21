import { eq } from "drizzle-orm";
import { ArrowLeftIcon, BadgeCheckIcon, FileTextIcon, Trash2Icon } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import { ImageDropzone, PROOF_TYPES } from "~/components/image-dropzone";
import { Container, FormError, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input, NativeSelect } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { requireMerchantAccount } from "~/lib/auth.server";
import { deleteLicense, LicenseError, saveLicense, storeLicenses, verifiedStoreIds } from "~/lib/business.server";
import { formatDay, isDateStr, today } from "~/lib/dates";
import { uploadPrivate, UploadError } from "~/lib/upload.server";
import { isUuid, str } from "~/lib/utils";
import type { Route } from "./+types/sell.business";

export const meta: Route.MetaFunction = () => [{ title: "Business information · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchantAccount(request);
  const [store, licenses, verified] = await Promise.all([
    db.query.stores.findFirst({ where: eq(schema.stores.id, user.storeId), columns: { registrationNumber: true, status: true } }),
    storeLicenses(user.storeId),
    verifiedStoreIds([user.storeId]),
  ]);
  return {
    store: store!,
    verified: verified.has(user.storeId),
    licenses: licenses.map(({ documentKey, ...l }) => ({ ...l, hasDocument: !!documentKey })),
    today: today(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireMerchantAccount(request);
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    if (intent === "registration") {
      const number = str(form.get("registrationNumber")).slice(0, 60);
      if (number.length < 3) return { error: "Enter your business registration number." };
      await db.update(schema.stores).set({ registrationNumber: number }).where(eq(schema.stores.id, user.storeId));
      return { ok: "Registration number saved." };
    }
    if (intent === "delete") {
      await deleteLicense(user.storeId, str(form.get("id")));
      return { ok: "Removed." };
    }
    const date = (k: string) => (isDateStr(str(form.get(k))) ? str(form.get(k)) : null);
    const id = str(form.get("id"));
    await saveLicense(
      user.storeId,
      {
        kind: form.get("kind") === "primary" ? "primary" : "other",
        name: str(form.get("name")).slice(0, 120),
        number: str(form.get("number")).slice(0, 60) || null,
        issuer: str(form.get("issuer")).slice(0, 120) || null,
        issuedOn: date("issuedOn"),
        expiresOn: date("expiresOn"),
      },
      await uploadPrivate(form.get("document"), "licenses", { documents: true }),
      isUuid(id) ? id : undefined,
    );
    return { ok: "Saved. An admin will verify it." };
  } catch (e) {
    if (e instanceof LicenseError || e instanceof UploadError) return { error: e.message };
    throw e;
  }
}

const TONE = { pending: "warning", verified: "success", rejected: "destructive" } as const;

export default function Business({ loaderData, actionData }: Route.ComponentProps) {
  const { store, verified, licenses, today } = loaderData;
  const busy = useNavigation().state !== "idle";
  const hasPrimary = licenses.some((l) => l.kind === "primary");

  return (
    <Container className="max-w-3xl py-8">
      <Link to={store.status === "approved" ? "/sell" : "/sell/pending"} className="mb-3 flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeftIcon className="size-4" /> Back
      </Link>
      <PageHeader
        title="Business information"
        description={
          verified ? (
            <span className="flex items-center gap-1.5 font-semibold text-success"><BadgeCheckIcon className="size-5" /> Registered business: customers see a green badge</span>
          ) : (
            "Upload your business registration certificate or licence. Once an admin verifies it, customers see a green 'Registered business' badge."
          )
        }
      />
      {actionData && "ok" in actionData ? <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p> : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <Form method="post" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="registration" />
            <Field label="Business registration number" className="flex-1">
              <Input name="registrationNumber" defaultValue={store.registrationNumber ?? ""} required minLength={3} />
            </Field>
            <Button type="submit" disabled={busy}>Save</Button>
          </Form>
        </CardContent>
      </Card>

      {licenses.length ? (
        <div className="mb-6 grid gap-3">
          {licenses.map((l) => {
            const expired = !!l.expiresOn && l.expiresOn < today;
            return (
              <Card key={l.id}>
                <CardContent className="flex flex-wrap items-start gap-3 pt-5 text-sm">
                  <FileTextIcon className="mt-0.5 size-5 text-primary" />
                  <div className="grid flex-1 gap-0.5">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      {l.name}
                      {l.kind === "primary" ? <Badge variant="accent">Primary</Badge> : null}
                      <Badge variant={expired ? "destructive" : TONE[l.status]} className="capitalize">{expired ? "Expired" : l.status}</Badge>
                      {l.showToCustomers && l.status === "verified" ? <Badge variant="outline">Shown to customers</Badge> : null}
                    </p>
                    <p className="text-muted-foreground">
                      {[l.number && `No. ${l.number}`, l.issuer, l.issuedOn && `issued ${formatDay(l.issuedOn, { day: "numeric", month: "short", year: "numeric" })}`, l.expiresOn && `expires ${formatDay(l.expiresOn, { day: "numeric", month: "short", year: "numeric" })}`].filter(Boolean).join(" · ")}
                    </p>
                    {l.reviewNote ? <p className="text-xs">Note from MyPlug: {l.reviewNote}</p> : null}
                    {l.hasDocument ? <a href={`/files/license/${l.id}`} target="_blank" rel="noreferrer" className="w-fit text-xs font-semibold text-accent hover:underline">View document</a> : null}
                  </div>
                  <Form method="post">
                    <input type="hidden" name="id" value={l.id} />
                    <Button type="submit" name="intent" value="delete" size="icon-sm" variant="ghost" aria-label="Remove"><Trash2Icon /></Button>
                  </Form>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Add a document</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" encType="multipart/form-data" className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <NativeSelect name="kind" defaultValue={hasPrimary ? "other" : "primary"}>
                <option value="primary">Business registration / licence (primary)</option>
                <option value="other">Other licence or permit</option>
              </NativeSelect>
            </Field>
            <Field label="Document name">
              <Input name="name" required placeholder="e.g. Certificate of Registration" />
            </Field>
            <Field label="Number">
              <Input name="number" />
            </Field>
            <Field label="Issued by">
              <Input name="issuer" placeholder="e.g. Registrar General, City Council" />
            </Field>
            <Field label="Issued on">
              <Input name="issuedOn" type="date" />
            </Field>
            <Field label="Expires on" hint="Leave empty if it doesn't expire. The badge lapses after this date.">
              <Input name="expiresOn" type="date" />
            </Field>
            <Field label="Scan or photo" className="sm:col-span-2">
              <ImageDropzone name="document" types={PROOF_TYPES} prompt="Add document" hint="PDF or photo, up to 4 MB" className="min-h-28" />
            </Field>
            <Button type="submit" disabled={busy} className="justify-self-start">Submit for verification</Button>
          </Form>
        </CardContent>
      </Card>
    </Container>
  );
}
