import { data, Form, Link, useNavigation } from "react-router";
import { Container, FlashMessage, FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Field, Input } from "~/components/ui/input";
import { getFlash, refreshSession, requireUser } from "~/lib/auth.server";
import { MIN_PASSWORD } from "~/lib/password";
import { changePassword, PasswordError } from "~/lib/password.server";
import type { Route } from "./+types/account.password";

export const meta: Route.MetaFunction = () => [{ title: "Change password · MyPlug" }];

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const { flash, headers } = await getFlash(request);
  return data({ email: user.email, flash }, { headers });
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  try {
    await changePassword(user.id, String(form.get("current") ?? ""), String(form.get("password") ?? ""), String(form.get("confirm") ?? ""));
  } catch (e) {
    if (e instanceof PasswordError) return { error: e.message };
    throw e;
  }
  // This session stays signed in; every other device is signed out.
  return refreshSession(request, "/account/password", { tone: "success", text: "Password changed. You've been signed out on your other devices." });
}

export default function ChangePassword({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <Container className="max-w-md py-8">
      <PageHeader title="Change password" description={loaderData.email} />
      <FlashMessage flash={loaderData.flash} />
      <Card>
        <CardContent className="pt-5">
          <Form method="post" className="grid gap-4" key={loaderData.flash ? "done" : "form"}>
            <FormError error={actionData?.error} />
            <Field label="Current password">
              <Input name="current" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="New password" hint={`At least ${MIN_PASSWORD} characters`}>
              <Input name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} />
            </Field>
            <Field label="Repeat new password">
              <Input name="confirm" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving..." : "Change password"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Forgotten your current password? Sign out and use <Link to="/forgot-password" className="font-semibold text-primary">Forgot password</Link>.
            </p>
          </Form>
        </CardContent>
      </Card>
    </Container>
  );
}
