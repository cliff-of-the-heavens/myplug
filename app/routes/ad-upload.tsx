import { CircleCheckBigIcon, LockKeyholeIcon } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { CreativeFields, PreparationTips } from "~/components/banner-forms";
import { FormError } from "~/components/page";
import { Logo } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input } from "~/components/ui/input";
import { BannerError, unlockUpload, uploadLinkState, uploadViaLink } from "~/lib/banners.server";
import { UploadError } from "~/lib/upload.server";
import type { Route } from "./+types/ad-upload";

// The token is in the address: keep it out of search engines and other sites' logs.
export const meta: Route.MetaFunction = () => [
  { title: "Upload your banner · MyPlug" },
  { name: "robots", content: "noindex" },
  { name: "referrer", content: "no-referrer" },
];

export async function loader({ params }: Route.LoaderArgs) {
  return { state: await uploadLinkState(params.token) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const passcode = String(form.get("passcode") ?? "");
  try {
    if (form.get("intent") === "upload") {
      await uploadViaLink(params.token, passcode, form);
      return { done: true as const };
    }
    const { campaign } = await unlockUpload(params.token, passcode);
    return { unlocked: { ...campaign, passcode } };
  } catch (e) {
    if (e instanceof BannerError || e instanceof UploadError) return { error: e.message, passcode: form.get("intent") === "upload" ? passcode : null };
    throw e;
  }
}

export default function AdUpload({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const unlocked = actionData && "unlocked" in actionData ? (actionData.unlocked ?? null) : null;
  const done = actionData && "done" in actionData;
  const error = actionData && "error" in actionData ? (actionData.error ?? null) : null;
  // A failed upload keeps the passcode so the advertiser doesn't have to type it again.
  const retryPasscode = actionData && "passcode" in actionData ? (actionData.passcode ?? "") : "";
  return (
    <div className="grid min-h-[70dvh] place-items-center px-4 py-10">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <Logo className="mb-2 justify-self-center" />
          <CardTitle className="text-2xl">Upload your banner</CardTitle>
          <CardDescription>A secure, one-time link from MyPlug.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {done ? (
            <div className="grid justify-items-center gap-2 text-center">
              <CircleCheckBigIcon className="size-10 text-success" />
              <p className="font-semibold">Thank you, your banner is uploaded.</p>
              <p className="text-sm text-muted-foreground">MyPlug will check it and confirm when your ad starts. This link no longer works.</p>
            </div>
          ) : !loaderData.state && !unlocked ? (
            <p className="text-center text-sm">This link has expired, was already used, or was locked after too many wrong passcodes. Please ask MyPlug for a new one.</p>
          ) : unlocked || retryPasscode ? (
            <UploadStep unlocked={unlocked} error={error} passcode={unlocked?.passcode ?? retryPasscode} busy={busy} />
          ) : (
            <Form method="post" className="grid gap-4">
              <input type="hidden" name="intent" value="unlock" />
              <FormError error={error} />
              <Field label="Passcode" hint="6 digits, sent to you by MyPlug">
                <Input name="passcode" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus autoComplete="one-time-code" className="text-center text-lg tracking-[0.4em]" />
              </Field>
              <Button type="submit" disabled={busy}>
                <LockKeyholeIcon /> Continue
              </Button>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type Unlocked = Extract<NonNullable<Route.ComponentProps["actionData"]>, { unlocked: unknown }>["unlocked"];

function UploadStep({ unlocked, error, passcode, busy }: { unlocked: Unlocked | null; error: string | null; passcode: string; busy: boolean }) {
  // After a failed upload the page re-renders without the campaign details; ask to start again.
  if (!unlocked) {
    return (
      <Form method="post" className="grid gap-3">
        <FormError error={error} />
        <input type="hidden" name="intent" value="unlock" />
        <input type="hidden" name="passcode" value={passcode} />
        <Button type="submit" disabled={busy}>
          Try again
        </Button>
      </Form>
    );
  }
  const p = unlocked.placement;
  return (
    <div className="grid gap-5">
      <div className="rounded-xl bg-secondary/60 p-3 text-sm">
        <p>
          Hi <strong>{unlocked.advertiserName}</strong>. This is for ad <strong>{unlocked.number}</strong>: <strong>{p.name}</strong>, {unlocked.weeks} week{unlocked.weeks > 1 ? "s" : ""}.
        </p>
        <p className="mt-1">
          Banner size: <strong>
            {p.width}×{p.height}px
          </strong>, up to {p.maxKb} KB.
        </p>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-primary">How to prepare your banner</summary>
        <div className="mt-3">
          <PreparationTips />
        </div>
      </details>
      <Form method="post" encType="multipart/form-data" className="grid gap-4">
        <input type="hidden" name="intent" value="upload" />
        <input type="hidden" name="passcode" value={passcode} />
        <FormError error={error} />
        <CreativeFields placement={p} required defaults={{ headline: unlocked.headline, linkUrl: unlocked.linkUrl }} />
        <Button type="submit" disabled={busy} className="justify-self-start">
          {busy ? "Uploading..." : "Upload banner"}
        </Button>
      </Form>
    </div>
  );
}
