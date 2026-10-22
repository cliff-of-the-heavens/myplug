import { eq } from "drizzle-orm";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { FormError } from "~/components/page";
import { Logo } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { createUserSession } from "~/lib/auth.server";
import { MIN_PASSWORD } from "~/lib/password";
import { findResetToken, PasswordError, resetPassword } from "~/lib/password.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/reset-password";

// The token is in the address: keep it out of search engines and other sites' logs.
export const meta: Route.MetaFunction = () => [
  { title: "Choose a new password · MyPlug" },
  { name: "robots", content: "noindex" },
  { name: "referrer", content: "no-referrer" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  return { valid: !!(await findResetToken(token)) };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  try {
    const userId = await resetPassword(str(form.get("token")), String(form.get("password") ?? ""), String(form.get("confirm") ?? ""));
    // Signed straight in with a fresh session (all older sessions were signed out).
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId), columns: { role: true } });
    const home = { merchant: "/sell", admin: "/admin", courier: "/courier", customer: "/" }[user?.role ?? "customer"];
    return createUserSession(request, userId, home);
  } catch (e) {
    if (e instanceof PasswordError) return { error: e.message };
    throw e;
  }
}

export default function ResetPassword({ loaderData, actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const busy = useNavigation().state !== "idle";
  return (
    <div className="grid min-h-[70dvh] place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Logo className="mb-2 justify-self-center" />
          <CardTitle className="text-2xl">Choose a new password</CardTitle>
          <CardDescription>You'll be signed in, and signed out everywhere else.</CardDescription>
        </CardHeader>
        <CardContent>
          {loaderData.valid ? (
            <Form method="post" className="grid gap-4">
              <input type="hidden" name="token" value={params.get("token") ?? ""} />
              <FormError error={actionData?.error} />
              <Field label="New password" hint={`At least ${MIN_PASSWORD} characters`}>
                <Input name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} autoFocus />
              </Field>
              <Field label="Repeat new password">
                <Input name="confirm" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} />
              </Field>
              <Button type="submit" size="lg" disabled={busy}>
                {busy ? "Saving..." : "Save new password"}
              </Button>
            </Form>
          ) : (
            <div className="grid gap-3 text-center text-sm">
              <p>This link has expired or was already used. Reset links work once, for an hour.</p>
              <Button asChild>
                <Link to="/forgot-password">Get a new link</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
