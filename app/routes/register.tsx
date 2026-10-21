import { eq } from "drizzle-orm";
import { redirect, useSearchParams } from "react-router";
import { z } from "zod";
import { RegisterForm } from "~/components/auth-dialog";
import { Logo } from "~/components/site-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { createUserSession, getUser, hashPassword, safeRedirect } from "~/lib/auth.server";
import { TERMS_VERSION } from "~/lib/terms";
import { slugify } from "~/lib/utils";
import type { Route } from "./+types/register";

export const meta: Route.MetaFunction = () => [{ title: "Create account · MyPlug" }];

const Schema = z
  .object({
    role: z.enum(["customer", "merchant", "courier"]),
    name: z.string().trim().min(2, "Enter your name"),
    email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
    phone: z.string().trim().optional(),
    password: z.string().min(8, "Use at least 8 characters"),
    storeName: z.string().trim().optional(),
    storeDescription: z.string().trim().optional(),
    registrationNumber: z.string().trim().max(60).optional(),
    terms: z.literal("on", { error: "You need to accept the Terms of Use" }),
  })
  .refine((v) => v.role !== "merchant" || (v.storeName?.length ?? 0) >= 2, {
    path: ["storeName"],
    message: "Give your store a name",
  })
  .refine((v) => v.role !== "merchant" || (v.registrationNumber?.length ?? 0) >= 3, {
    path: ["registrationNumber"],
    message: "Enter your business registration number",
  })
  .refine((v) => v.role !== "courier" || (v.phone?.length ?? 0) >= 7, {
    path: ["phone"],
    message: "Couriers need a phone number",
  });

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUser(request)) throw redirect("/");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = Object.fromEntries(await request.formData());
  const parsed = Schema.safeParse(form);
  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined> };
  }
  const v = parsed.data;

  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, v.email) });
  if (existing) return { errors: { email: ["An account with this email already exists"] } };

  const user = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({
        email: v.email,
        name: v.name,
        phone: v.phone || null,
        role: v.role,
        passwordHash: await hashPassword(v.password),
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: new Date(),
      })
      .returning();

    if (v.role === "courier") {
      // Identity documents are added next, on the courier profile page; an admin then approves the account.
      await tx.insert(schema.couriers).values({ userId: user.id, name: v.name, phone: v.phone! });
    }

    if (v.role === "merchant") {
      // Make a unique slug, e.g. "the-cake-lady", "the-cake-lady-2"
      const base = slugify(v.storeName!) || "store";
      let slug = base;
      for (let i = 2; await tx.query.stores.findFirst({ where: eq(schema.stores.slug, slug) }); i++) {
        slug = `${base}-${i}`;
      }
      await tx.insert(schema.stores).values({
        ownerId: user.id,
        name: v.storeName!,
        slug,
        description: v.storeDescription || null,
        registrationNumber: v.registrationNumber || null,
      });
    }
    return user;
  });

  // New merchants go to their dashboard, which shows the approval status until an admin approves them.
  if (v.role === "merchant") return createUserSession(request, user.id, "/sell");
  if (v.role === "courier") return createUserSession(request, user.id, "/courier/profile");
  return createUserSession(request, user.id, safeRedirect(form.redirectTo as string, "/"));
}

export default function Register() {
  const [params] = useSearchParams();
  return (
    <div className="grid place-items-center px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <Logo className="mb-2 justify-self-center" />
          <CardTitle className="text-2xl">Create your account</CardTitle>
          <CardDescription>Browse freely. Sign up to order, chat and sell.</CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterForm
            redirectTo={params.get("redirectTo") ?? ""}
            defaultRole={params.get("role") === "merchant" ? "merchant" : params.get("role") === "courier" ? "courier" : "customer"}
          />
        </CardContent>
      </Card>
    </div>
  );
}
