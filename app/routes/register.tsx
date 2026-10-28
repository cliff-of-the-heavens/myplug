import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { redirect, useSearchParams } from "react-router";
import { z } from "zod";
import { RegisterForm, toRole } from "~/components/auth-dialog";
import { Logo } from "~/components/site-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { clearSocialPending, createUserSession, getSocialPending, getUser, hashPassword, safeRedirect } from "~/lib/auth.server";
import { getCategories } from "~/lib/catalog.server";
import { HANDYMAN_GROUP } from "~/lib/handyman";
import { TERMS_VERSION } from "~/lib/terms";
import { slugify } from "~/lib/utils";
import type { Route } from "./+types/register";

export const meta: Route.MetaFunction = () => [{ title: "Create account · MyPlug" }];

const Schema = z
  .object({
    // A handyman is a merchant whose store is a tradesperson's profile.
    role: z.enum(["customer", "merchant", "courier", "handyman"]),
    name: z.string().trim().min(2, "Enter your name"),
    email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
    phone: z.string().trim().optional(),
    password: z.string().min(8, "Use at least 8 characters"),
    storeName: z.string().trim().optional(),
    storeDescription: z.string().trim().optional(),
    registrationNumber: z.string().trim().max(60).optional(),
    trades: z.array(z.string()).default([]),
    serviceArea: z.string().trim().max(200).optional(),
    terms: z.literal("on", { error: "You need to accept the Terms of Use" }),
  })
  .refine((v) => (v.role !== "merchant" && v.role !== "handyman") || (v.storeName?.length ?? 0) >= 2, {
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
  })
  // Many tradespeople aren't registered businesses: no registration number, but a phone, a trade and an area.
  .refine((v) => v.role !== "handyman" || (v.phone?.length ?? 0) >= 7, {
    path: ["phone"],
    message: "Customers need a number to call you on",
  })
  .refine((v) => v.role !== "handyman" || v.trades.length > 0, {
    path: ["trades"],
    message: "Choose at least one trade",
  })
  .refine((v) => v.role !== "handyman" || (v.serviceArea?.length ?? 0) >= 2, {
    path: ["serviceArea"],
    message: "Say where you work, e.g. Area 47, Lilongwe",
  });

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUser(request)) throw redirect("/");
  // Back from Google/Facebook as someone new: finish signing up with that account.
  const pending = await getSocialPending(request);
  return { social: pending ? { provider: pending.provider, email: pending.email, name: pending.name } : null };
}

export async function action({ request }: Route.ActionArgs) {
  const data = await request.formData();
  if (data.get("intent") === "forget-social") return clearSocialPending(request, "/register");
  const form = Object.fromEntries(data);
  // Google/Facebook sign-ups have no password (they can set one later with "Forgot password"),
  // and keep the email the provider gave.
  const social = await getSocialPending(request);
  const parsed = Schema.safeParse({
    ...form,
    ...(social ? { password: randomBytes(24).toString("base64url"), email: social.email ?? form.email } : {}),
    trades: data.getAll("trades").map(String),
  });
  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined> };
  }
  const v = parsed.data;
  const handyman = v.role === "handyman";
  const tradeSlugs = new Set((await getCategories()).filter((c) => c.group === HANDYMAN_GROUP).map((c) => c.slug));

  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, v.email) });
  if (existing) {
    return { errors: { email: [social ? "An account with this email already exists. Sign in with your password, then you can use this too." : "An account with this email already exists"] } };
  }

  const user = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({
        email: v.email,
        name: v.name,
        phone: v.phone || null,
        role: v.role === "handyman" ? "merchant" : v.role,
        passwordHash: await hashPassword(v.password),
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: new Date(),
      })
      .returning();
    if (social) {
      await tx.insert(schema.userIdentities).values({ userId: user.id, provider: social.provider, providerUserId: social.id, email: social.email });
    }

    if (v.role === "courier") {
      // Identity documents are added next, on the courier profile page; an admin then approves the account.
      await tx.insert(schema.couriers).values({ userId: user.id, name: v.name, phone: v.phone! });
    }

    if (v.role === "merchant" || handyman) {
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
        ...(handyman
          ? { isTradesperson: true, trades: v.trades.filter((t) => tradeSlugs.has(t)), serviceArea: v.serviceArea || null }
          : {}),
      });
    }
    return user;
  });

  // New merchants go to their dashboard, which shows the approval status until an admin approves them.
  if (v.role === "merchant") return createUserSession(request, user.id, "/sell");
  // Handymen upload their national ID next; an admin checks it before approving them.
  if (handyman) return createUserSession(request, user.id, "/sell/business");
  if (v.role === "courier") return createUserSession(request, user.id, "/courier/profile");
  return createUserSession(request, user.id, safeRedirect(form.redirectTo as string, "/"));
}

export default function Register({ loaderData }: Route.ComponentProps) {
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
            defaultRole={toRole(params.get("role"))}
            social={loaderData.social}
          />
        </CardContent>
      </Card>
    </div>
  );
}
