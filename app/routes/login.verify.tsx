import { eq } from "drizzle-orm";
import { data, Form, redirect, useNavigation } from "react-router";
import { CodeInput } from "~/components/code-input";
import { FlashMessage, FormError } from "~/components/page";
import { Logo } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { cancelMfaChallenge, getFlash, getMfaPending } from "~/lib/auth.server";
import { checkCode, hasAuthenticator, maskEmail, MfaError, sendEmailCode } from "~/lib/mfa.server";
import { completeSignIn } from "~/lib/signin.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/login.verify";

export const meta: Route.MetaFunction = () => [{ title: "Enter your code · MyPlug" }, { name: "robots", content: "noindex" }];

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

const person = (id: string) =>
  db.query.users.findFirst({ where: eq(schema.users.id, id), columns: { id: true, email: true, name: true, role: true, status: true } });

export async function loader({ request }: Route.LoaderArgs) {
  const pending = await getMfaPending(request);
  const user = pending && (await person(pending.userId));
  if (!pending || !user) throw redirect("/login");
  const { flash, headers } = await getFlash(request);
  return data({ email: maskEmail(user.email), hasApp: await hasAuthenticator(user.id), flash }, { headers });
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  if (form.get("intent") === "cancel") return cancelMfaChallenge(request);

  const pending = await getMfaPending(request);
  const user = pending && (await person(pending.userId));
  if (!pending || !user) throw redirect("/login");
  if (user.status !== "active") return { error: "This account has been suspended. Contact support." };

  try {
    if (form.get("intent") === "resend") {
      const { devCode } = await sendEmailCode(user, "login");
      return { sent: devCode ? `Development only (no email service set up): your code is ${devCode}` : `We've emailed a code to ${maskEmail(user.email)}.` };
    }
    await checkCode(user.id, str(form.get("code")), "login");
  } catch (e) {
    if (e instanceof MfaError) return { error: e.message };
    throw e;
  }
  return completeSignIn(request, user, pending.redirectTo, { mfaVerified: true });
}

export default function VerifyCode({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const { email, hasApp, flash } = loaderData;
  return (
    <div className="grid min-h-[70dvh] place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Logo className="mb-2 justify-self-center" />
          <CardTitle className="text-2xl">Enter your code</CardTitle>
          <CardDescription>{hasApp ? "Open your authenticator app, or email yourself a code." : `We've emailed a 6-digit code to ${email}. It works for 10 minutes.`}</CardDescription>
        </CardHeader>
        <CardContent>
          <FlashMessage flash={flash} />
          <Form method="post" className="grid gap-4">
            <FormError error={actionData && "error" in actionData ? actionData.error : null} />
            {actionData && "sent" in actionData ? <p className="rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.sent}</p> : null}
            <Field label="6-digit code" className="text-center">
              <CodeInput autoFocus resetOn={actionData} />
            </Field>
            <Button type="submit" size="lg" name="intent" value="verify" disabled={busy}>
              {busy ? "Checking..." : "Continue"}
            </Button>
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="submit" variant="ghost" size="sm" name="intent" value="resend" formNoValidate disabled={busy}>
                {hasApp ? "Email me a code" : "Send a new code"}
              </Button>
              <Button type="submit" variant="ghost" size="sm" name="intent" value="cancel" formNoValidate disabled={busy}>
                Cancel
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
