import { redirect } from "react-router";
import { ForgotForm } from "~/components/auth-dialog";
import { Logo } from "~/components/site-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getUser } from "~/lib/auth.server";
import { requestPasswordReset } from "~/lib/password.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/forgot-password";

export const meta: Route.MetaFunction = () => [{ title: "Forgot password · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUser(request)) throw redirect("/account/password");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const email = str((await request.formData()).get("email"));
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a valid email address." };
  const { devLink } = await requestPasswordReset(email);
  // Same answer whether or not the email has an account.
  return { sent: true, devLink };
}

export default function ForgotPassword() {
  return (
    <div className="grid min-h-[70dvh] place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Logo className="mb-2 justify-self-center" />
          <CardTitle className="text-2xl">Forgot your password?</CardTitle>
          <CardDescription>Enter your email and we'll send you a link to choose a new one.</CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotForm />
        </CardContent>
      </Card>
    </div>
  );
}
