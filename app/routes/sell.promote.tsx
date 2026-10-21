import { desc, eq } from "drizzle-orm";
import { CheckIcon, CrownIcon, MegaphoneIcon, RocketIcon, SparklesIcon, WandSparklesIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { AdStateBadge } from "~/components/ad-status";
import { ImageDropzone, PROOF_TYPES } from "~/components/image-dropzone";
import { EmptyState, FormError, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import type { PromotionTier } from "~/db/schema";
import {
  AdError,
  cancelAd,
  getBands,
  getSetting,
  PAYMENT_INSTRUCTIONS,
  requestBandAd,
  requestCustomAd,
  submitPayment,
} from "~/lib/ads.server";
import { requireMerchant } from "~/lib/auth.server";
import { date, money } from "~/lib/format";
import { AD_DURATIONS, adState, bandPrice, MAX_AD_DAYS, TIER_LABEL, TIER_WEIGHT } from "~/lib/promotions";
import { uploadProof, UploadError } from "~/lib/upload.server";
import { cn, str } from "~/lib/utils";
import type { Route } from "./+types/sell.promote";

export const meta: Route.MetaFunction = () => [{ title: "Advertise · MyPlug" }];

const TIER_ICON: Record<PromotionTier, typeof RocketIcon> = { boost: RocketIcon, featured: SparklesIcon, premium: CrownIcon };

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const { promotions, products } = schema;
  const [bands, myProducts, ads, instructions] = await Promise.all([
    getBands({ activeOnly: true }),
    db.query.products.findMany({
      where: (p, { and, eq }) => and(eq(p.storeId, user.storeId), eq(p.isActive, true)),
      columns: { id: true, title: true },
      orderBy: desc(products.createdAt),
    }),
    db
      .select({
        id: promotions.id,
        number: promotions.number,
        tier: promotions.tier,
        isCustom: promotions.isCustom,
        days: promotions.days,
        status: promotions.status,
        requestNote: promotions.requestNote,
        adminNote: promotions.adminNote,
        amountCents: promotions.amountCents,
        paymentReference: promotions.paymentReference,
        startsAt: promotions.startsAt,
        endsAt: promotions.endsAt,
        createdAt: promotions.createdAt,
        title: products.title,
      })
      .from(promotions)
      .innerJoin(products, eq(products.id, promotions.productId))
      .where(eq(products.storeId, user.storeId))
      .orderBy(desc(promotions.createdAt))
      .limit(50),
    getSetting(PAYMENT_INSTRUCTIONS),
  ]);
  return { bands, products: myProducts, ads, instructions };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireMerchant(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const storeId = user.storeId;
  try {
    if (intent === "band") {
      const ad = await requestBandAd({
        storeId,
        productId: str(form.get("productId")),
        tier: str(form.get("tier")),
        days: Number(form.get("days")),
      });
      return { ok: `Advert ${ad.number} created. Pay ${money(ad.amountCents ?? 0)} to get it approved.` };
    }
    if (intent === "custom") {
      const ad = await requestCustomAd({
        storeId,
        productId: str(form.get("productId")),
        days: Number(form.get("days")),
        note: str(form.get("note")),
      });
      return { ok: `Request ${ad.number} sent. We'll send you a quote shortly.` };
    }
    if (intent === "pay") {
      const proofUrl = await uploadProof(form.get("proof"), "payments");
      const ad = await submitPayment({ storeId, adId: str(form.get("adId")), reference: str(form.get("reference")), proofUrl });
      return { ok: `Thanks! Payment for ${ad.number} is now being checked. The advert goes live once it's approved.` };
    }
    if (intent === "cancel") {
      const ad = await cancelAd({ storeId, adId: str(form.get("adId")) });
      return { ok: `${ad.number} cancelled.` };
    }
  } catch (e) {
    if (e instanceof AdError || e instanceof UploadError) return { error: e.message };
    throw e;
  }
  return { error: "Unknown action." };
}

type Ad = Route.ComponentProps["loaderData"]["ads"][number];

function PaymentForm({ ad, instructions }: { ad: Ad; instructions: string | null }) {
  const busy = useNavigation().formData?.get("adId") === ad.id;
  return (
    <Form method="post" encType="multipart/form-data" className="grid gap-3 rounded-xl bg-secondary/50 p-4">
      <input type="hidden" name="adId" value={ad.id} />
      <p className="text-sm">
        Amount due: <strong className="text-lg">{money(ad.amountCents ?? 0)}</strong> · Reference: <strong>{ad.number}</strong>
      </p>
      {instructions ? <p className="text-sm whitespace-pre-line text-muted-foreground">{instructions}</p> : null}
      <div className="grid gap-3 md:grid-cols-[1fr_14rem]">
        <Field label="Payment reference" hint="Bank or mobile money transaction ID">
          <Input name="reference" maxLength={120} placeholder="e.g. TXN 8F2K19" />
        </Field>
        <Field label="Proof of payment">
          <ImageDropzone
            name="proof"
            types={PROOF_TYPES}
            prompt="Add proof"
            hint="Drop or click · PDF or image"
            className="min-h-28"
            imgClassName="max-h-40 w-full object-contain"
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="pay" disabled={busy}>
          {busy ? "Sending..." : "I've paid, submit for approval"}
        </Button>
        <Button type="submit" name="intent" value="cancel" variant="ghost" disabled={busy} formNoValidate>
          <XIcon /> Cancel advert
        </Button>
      </div>
    </Form>
  );
}

function AdRow({ ad, instructions }: { ad: Ad; instructions: string | null }) {
  const state = adState(ad);
  return (
    <li className="grid gap-3 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <AdStateBadge state={state} />
        <span className="font-mono text-xs text-muted-foreground">{ad.number}</span>
        <span className="font-semibold">{ad.title}</span>
        <span className="text-sm text-muted-foreground">
          {ad.tier ? TIER_LABEL[ad.tier] : "Custom"} · {ad.days} days
        </span>
        <span className="ml-auto font-bold">{ad.amountCents != null ? money(ad.amountCents) : "Quote pending"}</span>
      </div>
      {ad.isCustom && ad.requestNote ? <p className="text-sm text-muted-foreground">You asked: “{ad.requestNote}”</p> : null}
      {ad.adminNote ? (
        <p className={cn("rounded-lg px-3 py-2 text-sm", state === "rejected" ? "bg-destructive/10 text-destructive" : "bg-muted")}>
          <strong>MyPlug:</strong> {ad.adminNote}
        </p>
      ) : null}
      {state === "awaiting_payment" ? <PaymentForm ad={ad} instructions={instructions} /> : null}
      {state === "pending_quote" ? (
        <Form method="post" className="flex items-center gap-3 text-sm text-muted-foreground">
          <input type="hidden" name="adId" value={ad.id} />
          We'll price this request and bill you here.
          <Button type="submit" name="intent" value="cancel" variant="ghost" size="sm">
            Cancel request
          </Button>
        </Form>
      ) : null}
      {state === "payment_submitted" ? (
        <p className="text-sm text-muted-foreground">
          Payment{ad.paymentReference ? ` (ref ${ad.paymentReference})` : ""} received. An admin will approve the advert shortly.
        </p>
      ) : null}
      {state === "live" || state === "scheduled" ? (
        <p className="text-sm text-muted-foreground">
          Running {ad.startsAt ? date(ad.startsAt) : ""} → {ad.endsAt ? date(ad.endsAt) : ""}
        </p>
      ) : null}
      {state === "ended" && ad.endsAt ? <p className="text-sm text-muted-foreground">Ended {date(ad.endsAt)}</p> : null}
    </li>
  );
}

export default function Promote({ loaderData, actionData }: Route.ComponentProps) {
  const { bands, products, ads, instructions } = loaderData;
  const [mode, setMode] = useState<"band" | "custom">("band");
  const [tier, setTier] = useState<PromotionTier | undefined>(bands.find((b) => b.tier === "featured")?.tier ?? bands[0]?.tier);
  const [days, setDays] = useState(7);
  const busy = useNavigation().formData?.get("intent") === mode;
  const band = bands.find((b) => b.tier === tier);

  return (
    <>
      <PageHeader
        title="Advertise your products"
        description="Choose a band, or ask for a custom advert. Adverts go live once your payment has been approved."
      />
      {actionData && "ok" in actionData ? (
        <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p>
      ) : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />

      <div className="mt-4 mb-4 inline-flex rounded-full border-2 bg-card p-1">
        {(
          [
            ["band", "Advertised bands", MegaphoneIcon],
            ["custom", "Custom advert", WandSparklesIcon],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
              mode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {!products.length ? (
        <EmptyState icon={MegaphoneIcon} title="Add a product first">
          You need at least one listed product to advertise.
        </EmptyState>
      ) : mode === "band" ? (
        <Form method="post" className="grid gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            {bands.map((b) => {
              const Icon = TIER_ICON[b.tier];
              return (
                <label
                  key={b.tier}
                  className={cn(
                    "relative grid cursor-pointer content-start gap-3 rounded-2xl border-2 bg-card p-5 transition-all",
                    tier === b.tier ? "border-primary shadow-lg shadow-primary/15" : "hover:border-primary/40",
                  )}
                >
                  <input type="radio" name="tier" value={b.tier} checked={tier === b.tier} onChange={() => setTier(b.tier)} className="sr-only" />
                  {b.tier === "featured" ? <Badge variant="sponsored" className="absolute -top-3 right-4">Most popular</Badge> : null}
                  <Icon className="size-7 text-primary" />
                  <div>
                    <p className="text-lg font-extrabold">{b.name}</p>
                    <p>
                      <span className="text-2xl font-black">{money(b.weeklyCents)}</span>
                      <span className="text-sm text-muted-foreground"> / week</span>
                    </p>
                  </div>
                  <p className="text-sm">{b.description}</p>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckIcon className="size-4 text-success" /> {TIER_WEIGHT[b.tier] + 1}× more likely to be shown first
                  </p>
                </label>
              );
            })}
          </div>

          <Card>
            <CardContent className="grid gap-4 pt-5 md:grid-cols-[1fr_10rem_auto] md:items-end">
              <Field label="Product to promote">
                <NativeSelect name="productId" required>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Duration">
                <NativeSelect name="days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {AD_DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Button type="submit" name="intent" value="band" size="lg" variant="gradient" disabled={busy || !band}>
                Get invoice · {band ? money(bandPrice(band.weeklyCents, days)) : "-"}
              </Button>
            </CardContent>
          </Card>
        </Form>
      ) : (
        <Card>
          <CardContent className="pt-5">
            <Form method="post" className="grid gap-4 md:grid-cols-2">
              <Field label="Product to promote">
                <NativeSelect name="productId" required>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="How many days?">
                <Input name="days" type="number" min={1} max={MAX_AD_DAYS} defaultValue={14} required />
              </Field>
              <Field label="What would you like?" className="md:col-span-2" hint="Placement, dates, a launch or sale you're planning, your budget...">
                <Textarea name="note" required minLength={10} rows={4} placeholder="e.g. Top of the home page for our Black Friday sale, 20-30 November." />
              </Field>
              <Button type="submit" name="intent" value="custom" disabled={busy} className="justify-self-start">
                {busy ? "Sending..." : "Request a quote"}
              </Button>
            </Form>
          </CardContent>
        </Card>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Your adverts</CardTitle>
        </CardHeader>
        <CardContent>
          {ads.length ? (
            <ul className="divide-y">
              {ads.map((ad) => (
                <AdRow key={ad.id} ad={ad} instructions={instructions} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No adverts yet.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
