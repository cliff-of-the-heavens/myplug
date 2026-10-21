import { HardDriveIcon, PlayIcon, PlugZapIcon } from "lucide-react";
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input, NativeSelect } from "~/components/ui/input";
import { requireAdmin } from "~/lib/auth.server";
import { runDuePlans } from "~/lib/recurring.server";
import { getRetentionSettings, retentionCandidates, runRetention, saveRetentionSettings } from "~/lib/retention.server";
import {
  getStorageSettings,
  resolveBackend,
  saveStorageSettings,
  StorageError,
  testFtp,
  type FtpConfig,
  type StorageBackend,
} from "~/lib/storage.server";
import { cn, str } from "~/lib/utils";
import type { Route } from "./+types/admin.system";

export const meta: Route.MetaFunction = () => [{ title: "System settings · Admin · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const [{ backend, ftp }, retention] = await Promise.all([getStorageSettings(), getRetentionSettings()]);
  const candidates = await retentionCandidates(retention);
  return {
    backend,
    activeBackend: resolveBackend(backend),
    blobConfigured: !!process.env.BLOB_READ_WRITE_TOKEN,
    // Never send the password back to the browser; only whether one is saved.
    ftp: { ...ftp, password: undefined, hasPassword: !!ftp.password },
    retention,
    preview: {
      archive: candidates.toArchive.map((s) => s.name),
      warn: candidates.toWarn.map((s) => s.name),
      delete: candidates.toDelete.map((s) => s.name),
    },
  };
}

function ftpFromForm(form: FormData): Omit<FtpConfig, "password"> & { password?: string } {
  const secure = str(form.get("ftpSecure"));
  return {
    host: str(form.get("ftpHost")).slice(0, 200),
    port: Math.min(65535, Math.max(1, Number(form.get("ftpPort")) || 21)),
    user: str(form.get("ftpUser")).slice(0, 200),
    password: str(form.get("ftpPassword")) || undefined,
    secure: secure === "none" || secure === "implicit" ? secure : "explicit",
    directory: str(form.get("ftpDirectory")) || "/",
    publicBaseUrl: str(form.get("ftpPublicBaseUrl")).replace(/\/$/, ""),
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "storage" || intent === "test-ftp") {
    const backend = str(form.get("backend")) as StorageBackend;
    if (!["auto", "blob", "ftp", "local"].includes(backend)) return { error: "Choose a storage option." };
    const ftp = ftpFromForm(form);
    if (backend === "ftp" || intent === "test-ftp") {
      if (!ftp.host || !ftp.user) return { error: "Enter the FTP host and username." };
      if (!/^https?:\/\//.test(ftp.publicBaseUrl)) return { error: "Public base URL must start with http:// or https://" };
    }
    if (intent === "test-ftp") {
      const saved = await getStorageSettings();
      try {
        await testFtp({ ...ftp, password: ftp.password ?? saved.ftp.password });
        return { ok: "FTP works: a test file was uploaded, read back over HTTP and removed." };
      } catch (e) {
        if (e instanceof StorageError) return { error: e.message };
        throw e;
      }
    }
    await saveStorageSettings(backend, backend === "ftp" ? ftp : null);
    return { ok: "Storage settings saved. New uploads use them straight away." };
  }

  if (intent === "retention") {
    const int = (name: string, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(Number(form.get(name)) || min)));
    const archiveMonths = int("archiveMonths", 1, 60);
    const deleteMonths = int("deleteMonths", 2, 120);
    if (deleteMonths <= archiveMonths) return { error: "Deletion must come after archiving." };
    await saveRetentionSettings({ enabled: form.get("enabled") === "on", archiveMonths, deleteMonths, warningDays: int("warningDays", 1, 90) });
    return { ok: "Retention settings saved." };
  }

  if (intent === "run-daily") {
    const [plans, retention] = [await runDuePlans(), await runRetention()];
    return {
      ok: `Done. Repeat orders: ${plans.created} deliveries created, ${plans.skipped} skipped. Stores: ${retention.archived} archived, ${retention.warned} warned, ${retention.deleted} deleted.`,
    };
  }
  return { error: "Unknown action." };
}

const BACKENDS: { value: StorageBackend; label: string; text: string }[] = [
  { value: "auto", label: "Automatic", text: "Vercel Blob when configured, otherwise local files (development)" },
  { value: "blob", label: "Vercel Blob", text: "Vercel's file storage (needs BLOB_READ_WRITE_TOKEN)" },
  { value: "ftp", label: "FTP / FTPS server", text: "Your own server, e.g. a hosting account or another data centre" },
  { value: "local", label: "Local disk", text: "public/uploads, for development only" },
];

export default function SystemSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { backend, activeBackend, blobConfigured, ftp, retention, preview } = loaderData;
  const [choice, setChoice] = useState<StorageBackend>(backend);
  const busy = useNavigation().state !== "idle";

  return (
    <>
      <PageHeader title="System settings" description="Where uploaded files are kept, and how long inactive stores are kept." />
      {actionData && "ok" in actionData ? (
        <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p>
      ) : null}
      <div className="mb-4">
        <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDriveIcon className="size-5 text-primary" /> File storage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Uploads currently go to: <strong className="text-foreground">{BACKENDS.find((b) => b.value === activeBackend)?.label}</strong>
              {!blobConfigured ? " · Vercel Blob is not configured" : ""}. Existing files stay where they are.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {BACKENDS.map((b) => (
                <label
                  key={b.value}
                  className={cn("flex cursor-pointer gap-2 rounded-xl border-2 p-3 text-sm", choice === b.value ? "border-primary bg-primary/5" : "hover:border-primary/40")}
                >
                  <input type="radio" name="backend" value={b.value} checked={choice === b.value} onChange={() => setChoice(b.value)} className="mt-0.5 accent-primary" />
                  <span className="grid">
                    <span className="font-semibold">{b.label}</span>
                    <span className="text-xs text-muted-foreground">{b.text}</span>
                  </span>
                </label>
              ))}
            </div>

            {choice === "ftp" ? (
              <div className="grid gap-3 rounded-xl bg-muted/50 p-4 sm:grid-cols-2">
                <Field label="Host">
                  <Input name="ftpHost" defaultValue={ftp.host} placeholder="ftp.example.com" required />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Port">
                    <Input name="ftpPort" type="number" defaultValue={ftp.port} />
                  </Field>
                  <Field label="Encryption">
                    <NativeSelect name="ftpSecure" defaultValue={ftp.secure}>
                      <option value="explicit">FTPS (explicit TLS)</option>
                      <option value="implicit">FTPS (implicit, port 990)</option>
                      <option value="none">None (plain FTP, not recommended)</option>
                    </NativeSelect>
                  </Field>
                </div>
                <Field label="Username">
                  <Input name="ftpUser" defaultValue={ftp.user} autoComplete="off" required />
                </Field>
                <Field label="Password" hint={ftp.hasPassword ? "Saved (encrypted). Leave blank to keep it." : "Stored encrypted."}>
                  <Input name="ftpPassword" type="password" autoComplete="new-password" />
                </Field>
                <Field label="Remote folder" hint="Created if it doesn't exist">
                  <Input name="ftpDirectory" defaultValue={ftp.directory} placeholder="/public_html/uploads" />
                </Field>
                <Field label="Public base URL" hint="Where that folder is served over the web">
                  <Input name="ftpPublicBaseUrl" defaultValue={ftp.publicBaseUrl} placeholder="https://files.example.com/uploads" required />
                </Field>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Browsers can't load images over FTP, so the folder must also be reachable over HTTPS (most hosting accounts
                  serve their public folder this way). "Test connection" uploads a small file and checks it at that URL.
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="intent" value="storage" disabled={busy}>
                Save storage settings
              </Button>
              {choice === "ftp" ? (
                <Button type="submit" name="intent" value="test-ftp" variant="outline" disabled={busy}>
                  <PlugZapIcon /> Test connection
                </Button>
              ) : null}
            </div>
          </Form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Inactive stores</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Form method="post" className="grid gap-4 sm:grid-cols-3">
            <input type="hidden" name="intent" value="retention" />
            <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-3">
              <input type="checkbox" name="enabled" defaultChecked={retention.enabled} className="size-4 accent-primary" />
              Archive and delete inactive stores automatically
            </label>
            <Field label="Archive after (months inactive)" hint="Listings are hidden; signing in restores the store">
              <Input name="archiveMonths" type="number" min={1} max={60} defaultValue={retention.archiveMonths} />
            </Field>
            <Field label="Delete after (months inactive)" hint="Login, profile and listings removed; sales records kept">
              <Input name="deleteMonths" type="number" min={2} max={120} defaultValue={retention.deleteMonths} />
            </Field>
            <Field label="Warn the owner (days before deletion)">
              <Input name="warningDays" type="number" min={1} max={90} defaultValue={retention.warningDays} />
            </Field>
            <Button type="submit" disabled={busy} className="justify-self-start">
              Save retention settings
            </Button>
          </Form>
          <div className="grid gap-1 rounded-xl bg-muted/50 p-3 text-sm">
            <p className="font-semibold">If the daily job ran now:</p>
            <p>Archive: {preview.archive.length ? preview.archive.join(", ") : "none"}</p>
            <p>Warn before deletion: {preview.warn.length ? preview.warn.join(", ") : "none"}</p>
            <p>Delete: {preview.delete.length ? preview.delete.join(", ") : "none"}</p>
            <p className="text-xs text-muted-foreground">
              A store counts as active when its owner signs in or uses MyPlug, or when a customer orders from it. Owners are
              emailed when their store is archived and again before deletion.
            </p>
          </div>
          <Form method="post">
            <Button type="submit" name="intent" value="run-daily" variant="outline" size="sm" disabled={busy}>
              <PlayIcon /> Run the daily jobs now (repeat deliveries + inactive stores)
            </Button>
          </Form>
        </CardContent>
      </Card>
    </>
  );
}
