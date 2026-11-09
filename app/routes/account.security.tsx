import { ShieldCheckIcon, SmartphoneIcon } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { CodeInput } from "~/components/code-input";
import { Container, FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field } from "~/components/ui/input";
import { requireUser } from "~/lib/auth.server";
import {
  authenticatorSetupDetails,
  cancelAuthenticatorSetup,
  confirmAuthenticator,
  disableMfa,
  enableEmailMfa,
  mfaMandatory,
  mfaSettings,
  MfaError,
  removeAuthenticator,
  sendEmailCode,
  startAuthenticatorSetup,
  type OtpPurpose,
} from "~/lib/mfa.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/account.security";

export const meta: Route.MetaFunction = () => [{ title: "Two-step sign-in · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const { enabled, hasTotp, pendingSecret } = await mfaSettings(user.id);
  return {
    email: user.email,
    mandatory: mfaMandatory(user.role),
    enabled,
    hasTotp,
    setup: pendingSecret ? await authenticatorSetupDetails(user.email, pendingSecret) : null,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = str(form.get("intent"));
  const code = str(form.get("code"));
  const sent = async (purpose: OtpPurpose) => {
    const { devCode } = await sendEmailCode(user, purpose);
    return { sent: purpose, notice: devCode ? `Development only (no email service set up): your code is ${devCode}` : `We've emailed a code to ${user.email}. It works for 10 minutes.` };
  };

  try {
    switch (intent) {
      case "send-enable":
        return await sent("enable");
      case "send-disable":
        return await sent("disable");
      case "enable":
        await enableEmailMfa(user, code);
        return { ok: "Two-step sign-in is on. You'll be asked for a code each time you sign in." };
      case "disable":
        await disableMfa(user, code);
        return { ok: "Two-step sign-in is off." };
      case "totp-start":
        await startAuthenticatorSetup(user.id);
        return { ok: "Scan the code below with your authenticator app." };
      case "totp-cancel":
        await cancelAuthenticatorSetup(user.id);
        return { ok: "Authenticator setup cancelled." };
      case "totp-confirm":
        await confirmAuthenticator(user, code);
        return { ok: "Your authenticator app is connected." };
      case "totp-remove":
        await removeAuthenticator(user, code);
        return { ok: "Your authenticator app was removed." };
      default:
        return { error: "Unknown action." };
    }
  } catch (e) {
    if (e instanceof MfaError) return { error: e.message, sent: intent === "enable" ? ("enable" as const) : undefined };
    throw e;
  }
}

function CodeField({ label = "6-digit code" }: { label?: string }) {
  return (
    <Field label={label} className="text-center">
      <CodeInput />
    </Field>
  );
}

/** Asks for a code before something sensitive is turned off. */
function ConfirmWithCode({ intent, label, hasTotp, busy }: { intent: string; label: string; hasTotp: boolean; busy: boolean }) {
  return (
    <Form method="post" className="grid gap-3 rounded-xl bg-muted/50 p-4">
      <p className="text-sm text-muted-foreground">
        To {label.toLowerCase()}, enter a code {hasTotp ? "from your authenticator app, or one we email you" : "we email you"}.
      </p>
      <CodeField />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" size="sm" name="intent" value={intent} disabled={busy}>
          {label}
        </Button>
        <Button type="submit" variant="ghost" size="sm" name="intent" value="send-disable" formNoValidate disabled={busy}>
          Email me a code
        </Button>
      </div>
    </Form>
  );
}

export default function Security({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const { email, mandatory, enabled, hasTotp, setup } = loaderData;
  const result = actionData as { ok?: string; error?: string; sent?: OtpPurpose; notice?: string } | undefined;
  const isOn = enabled || mandatory;

  return (
    <Container className="max-w-xl py-8">
      <PageHeader title="Two-step sign-in" description="A code as well as your password, so a stolen password isn't enough to get in." />
      {result?.ok ? <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{result.ok}</p> : null}
      {result?.notice ? <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{result.notice}</p> : null}
      <div className="mb-4">
        <FormError error={result?.error} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-5 text-primary" /> Codes by email
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm">
            Status: <strong>{mandatory ? "On (required for admin accounts)" : isOn ? "On" : "Off"}</strong>. Codes go to {email}.
          </p>
          {mandatory ? null : isOn ? (
            <ConfirmWithCode intent="disable" label="Turn off two-step sign-in" hasTotp={hasTotp} busy={busy} />
          ) : result?.sent === "enable" ? (
            <Form method="post" className="grid gap-3 rounded-xl bg-muted/50 p-4">
              <CodeField label="Enter the code we emailed you" />
              <Button type="submit" name="intent" value="enable" disabled={busy} className="justify-self-start">
                Turn on
              </Button>
            </Form>
          ) : (
            <Form method="post">
              <Button type="submit" name="intent" value="send-enable" disabled={busy}>
                Email me a code to turn this on
              </Button>
            </Form>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SmartphoneIcon className="size-5 text-primary" /> Authenticator app
          </CardTitle>
          <p className="text-sm text-muted-foreground">Use Google Authenticator, Microsoft Authenticator, Authy or similar. Works without waiting for an email.</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          {hasTotp ? (
            <>
              <p className="text-sm">
                Status: <strong>Connected</strong>. If you lose your phone, you can still sign in with a code by email.
              </p>
              <ConfirmWithCode intent="totp-remove" label="Remove authenticator app" hasTotp busy={busy} />
            </>
          ) : setup ? (
            <div className="grid gap-4">
              <img src={setup.qr} alt="QR code to scan with your authenticator app" width={200} height={200} className="rounded-lg bg-white p-2" />
              <p className="text-sm">
                Can't scan it? Type this key into the app: <code className="font-mono font-semibold break-all">{setup.key}</code>
              </p>
              <Form method="post" className="grid gap-3">
                <CodeField label="Enter the code the app shows" />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" name="intent" value="totp-confirm" disabled={busy}>
                    Connect app
                  </Button>
                  <Button type="submit" variant="ghost" name="intent" value="totp-cancel" formNoValidate disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </Form>
            </div>
          ) : (
            <Form method="post">
              <Button type="submit" variant="outline" name="intent" value="totp-start" disabled={busy}>
                Set up an authenticator app
              </Button>
            </Form>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
