import { redirect, useSearchParams } from "react-router";
import { LoginForm } from "~/components/auth-dialog";
import { Logo } from "~/components/site-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { createUserSession, getUser, safeRedirect, touchActivity, verifyLogin } from "~/lib/auth.server";
import { restoreArchivedStore } from "~/lib/retention.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/login";

export const meta: Route.MetaFunction = () => [{ title: "Sign in · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUser(request)) throw redirect("/");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = str(form.get("email"));
  const password = str(form.get("password"));
  const user = await verifyLogin(email, password);
  if (!user) return { error: "Incorrect email or password." };
  if (user.status !== "active") return { error: "This account has been suspended. Contact support." };
  await touchActivity(user.id);
  // A merchant coming back to an inactive (archived) store gets it back straight away.
  if (user.role === "merchant") await restoreArchivedStore(user.id);

  // Merchants and admins land on their dashboards unless they were heading somewhere specific.
  const home = { merchant: "/sell", admin: "/admin", courier: "/courier", customer: "/" }[user.role];
  const target = safeRedirect(form.get("redirectTo"), home);
  return createUserSession(request, user.id, target === "/" ? home : target);
}

export default function Login() {
  const [params] = useSearchParams();
  return (
    <div className="grid min-h-[70dvh] place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Logo className="mb-2 justify-self-center" />
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>Sign in to order, chat with merchants and track deliveries.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm redirectTo={params.get("redirectTo") ?? ""} />
        </CardContent>
      </Card>
    </div>
  );
}
