import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { CheckIcon, FileTextIcon, MegaphoneIcon, RotateCcwIcon, SquareIcon, XIcon } from "lucide-react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { AdStateBadge } from "~/components/ad-status";
import { EmptyState, FormError, PageHeader } from "~/components/page";
import { SafeImage } from "~/components/safe-image";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Field, Input, NativeSelect } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { promotionTier, type PromotionTier } from "~/db/schema";
import { AdError, approveAd, endAd, getBands, liveAd, quoteAd, rejectAd, requestNewPayment } from "~/lib/ads.server";
import { likeTerm } from "~/lib/admin.server";
import { requireAdmin } from "~/lib/auth.server";
import { date, money, parseMoney, timeAgo } from "~/lib/format";
import { AD_STATE_LABEL, adState, bandPrice, MAX_AD_DAYS, TIER_LABEL } from "~/lib/promotions";
import { cn, str } from "~/lib/utils";
import type { Route } from "./+types/admin.ads";

export const meta: Route.MetaFunction = () => [{ title: "Adverts · Admin · MyPlug" }];

const { promotions, products, stores } = schema;

/** Filter tabs. "live" is approved and currently running; "approved" is every approved advert. */
const FILTERS: Record<string, SQL | undefined> = {
  pending_quote: eq(promotions.status, "pending_quote"),
  awaiting_payment: eq(promotions.status, "awaiting_payment"),
  payment_submitted: eq(promotions.status, "payment_submitted"),
  live: liveAd,
  approved: eq(promotions.status, "approved"),
  rejected: eq(promotions.status, "rejected"),
  cancelled: eq(promotions.status, "cancelled"),
};
const TABS: [string | null, string][] = [
  ["payment_submitted", "To verify"],
  ["pending_quote", "To quote"],
  ["awaiting_payment", "Awaiting payment"],
  ["live", "Live"],
  ["approved", "All approved"],
  ["rejected", "Rejected"],
  ["cancelled", "Cancelled"],
  [null, "All"],
];

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const filter = status && status in FILTERS ? status : null;
  const q = url.searchParams.get("q")?.trim() ?? "";

  const [ads, bands] = await Promise.all([
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
        proofUrl: promotions.proofUrl,
        paymentSubmittedAt: promotions.paymentSubmittedAt,
        approvedAt: promotions.approvedAt,
        startsAt: promotions.startsAt,
        endsAt: promotions.endsAt,
        createdAt: promotions.createdAt,
        productId: products.id,
        productTitle: products.title,
        productImage: products.imageUrl,
        storeName: stores.name,
        storeOwnerId: stores.ownerId,
      })
      .from(promotions)
      .innerJoin(products, eq(products.id, promotions.productId))
      .innerJoin(stores, eq(stores.id, products.storeId))
      .where(
        and(
          filter ? FILTERS[filter] : undefined,
          q
            ? or(
                ilike(promotions.number, likeTerm(q)),
                ilike(products.title, likeTerm(q)),
                ilike(stores.name, likeTerm(q)),
                ilike(promotions.paymentReference, likeTerm(q)),
              )
            : undefined,
        ),
      )
      // Oldest first for work queues so nobody waits too long; newest first otherwise
      .orderBy(
        filter === "payment_submitted" || filter === "pending_quote"
          ? promotions.updatedAt
          : desc(promotions.createdAt),
      )
      .limit(100),
    getBands(),
  ]);
  return { ads, bands, filter, q };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  const form = await request.formData();
  const adId = str(form.get("adId"));
  const note = str(form.get("note")).slice(0, 500);
  const base = { adminId: admin.id, adId, note };
  try {
    switch (form.get("intent")) {
      case "quote": {
        const tier = str(form.get("tier")) as PromotionTier;
        if (!promotionTier.enumValues.includes(tier)) return { error: "Choose a placement band." };
        const ad = await quoteAd({ ...base, tier, days: Number(form.get("days")), amountCents: parseMoney(form.get("amount")) ?? 0 });
        return { ok: `${ad.number} billed at ${money(ad.amountCents ?? 0)}. The merchant can now pay.` };
      }
      case "approve": {
        const ad = await approveAd(base);
        return { ok: `${ad.number} approved and live until ${date(ad.endsAt!)}.` };
      }
      case "repay": {
        const ad = await requestNewPayment(base);
        return { ok: `${ad.number} sent back to the merchant.` };
      }
      case "reject": {
        const ad = await rejectAd(base);
        return { ok: `${ad.number} rejected.` };
      }
      case "end": {
        const ad = await endAd(base);
        return { ok: `${ad.number} stopped.` };
      }
    }
  } catch (e) {
    if (e instanceof AdError) return { error: e.message };
    throw e;
  }
  return { error: "Unknown action." };
}

type Ad = Route.ComponentProps["loaderData"]["ads"][number];
type Band = Route.ComponentProps["loaderData"]["bands"][number];

function Proof({ url }: { url: string }) {
  if (url.toLowerCase().endsWith(".pdf")) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
        <FileTextIcon className="size-4" /> Open proof (PDF)
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block w-fit" title="Open full size">
      <img src={url} alt="Proof of payment" className="max-h-40 rounded-lg border object-contain" />
    </a>
  );
}

function QuoteForm({ ad, bands }: { ad: Ad; bands: Band[] }) {
  const suggested = bands.find((b) => b.tier === (ad.tier ?? "featured"));
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <Field label="Placement">
        <NativeSelect name="tier" defaultValue={ad.tier ?? "featured"} className="h-9">
          {bands.map((b) => (
            <option key={b.tier} value={b.tier}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Days">
        <Input name="days" type="number" min={1} max={MAX_AD_DAYS} defaultValue={ad.days} className="h-9" />
      </Field>
      <Field label="Amount (MK)">
        <Input
          name="amount"
          inputMode="decimal"
          className="h-9"
          defaultValue={
            ad.amountCents != null
              ? ad.amountCents / 100
              : suggested
                ? bandPrice(suggested.weeklyCents, ad.days) / 100
                : ""
          }
        />
      </Field>
    </div>
  );
}

function AdCard({ ad, bands }: { ad: Ad; bands: Band[] }) {
  const state = adState(ad);
  const nav = useNavigation();
  const busy = nav.formData?.get("adId") === ad.id;
  const canQuote = ad.status === "pending_quote" || ad.status === "awaiting_payment";

  return (
    <Card id={ad.number} className={cn(busy && "opacity-60")}>
      <CardContent className="grid gap-4 pt-5 md:grid-cols-[5rem_1fr]">
        <SafeImage src={ad.productImage} alt="" className="size-20 rounded-xl border" />
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <AdStateBadge state={state} />
            <span className="font-mono text-sm font-bold">{ad.number}</span>
            <Link to={`/p/${ad.productId}`} className="font-semibold hover:text-primary">{ad.productTitle}</Link>
            <span className="text-sm text-muted-foreground">
              by <Link to={`/admin/users/${ad.storeOwnerId}`} className="hover:text-primary">{ad.storeName}</Link>
            </span>
            <span className="ml-auto text-lg font-black">{ad.amountCents != null ? money(ad.amountCents) : "Not quoted"}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {ad.isCustom ? "Custom request" : "Band"} · {ad.tier ? TIER_LABEL[ad.tier] : "placement to be set"} · {ad.days} days ·
            requested {timeAgo(ad.createdAt)}
            {ad.startsAt && ad.endsAt ? ` · runs ${date(ad.startsAt)} → ${date(ad.endsAt)}` : ""}
          </p>
          {ad.requestNote ? <p className="rounded-lg bg-muted px-3 py-2 text-sm">“{ad.requestNote}”</p> : null}
          {ad.status === "payment_submitted" || ad.paymentReference || ad.proofUrl ? (
            <div className="grid gap-2 rounded-lg border-2 border-dashed p-3">
              <p className="text-sm">
                <strong>Payment</strong>
                {ad.paymentSubmittedAt ? ` submitted ${timeAgo(ad.paymentSubmittedAt)}` : ""}
                {ad.paymentReference ? (
                  <>
                    {" "}· reference <span className="font-mono font-semibold">{ad.paymentReference}</span>
                  </>
                ) : null}
              </p>
              {ad.proofUrl ? <Proof url={ad.proofUrl} /> : <p className="text-xs text-muted-foreground">No proof file attached.</p>}
            </div>
          ) : null}
          {ad.adminNote ? <p className="text-xs text-muted-foreground">Note to merchant: {ad.adminNote}</p> : null}

          {state !== "ended" && state !== "rejected" && state !== "cancelled" ? (
            <Form method="post" className="grid gap-2 border-t pt-3">
              <input type="hidden" name="adId" value={ad.id} />
              {canQuote ? <QuoteForm ad={ad} bands={bands} /> : null}
              <Input name="note" placeholder="Note to the merchant (needed to reject or send back)" className="h-9" maxLength={500} />
              <div className="flex flex-wrap gap-2">
                {canQuote ? (
                  <Button type="submit" name="intent" value="quote" size="sm" disabled={busy}>
                    {ad.status === "pending_quote" ? "Send quote & bill merchant" : "Update bill"}
                  </Button>
                ) : null}
                {ad.status === "payment_submitted" ? (
                  <>
                    <Button type="submit" name="intent" value="approve" size="sm" variant="accent" disabled={busy}>
                      <CheckIcon /> Payment received: approve & go live
                    </Button>
                    <Button type="submit" name="intent" value="repay" size="sm" variant="outline" disabled={busy}>
                      <RotateCcwIcon /> Send back (payment not found)
                    </Button>
                  </>
                ) : null}
                {ad.status === "awaiting_payment" ? (
                  <Button type="submit" name="intent" value="approve" size="sm" variant="secondary" disabled={busy}>
                    <CheckIcon /> Paid another way: approve
                  </Button>
                ) : null}
                {ad.status !== "approved" ? (
                  <Button type="submit" name="intent" value="reject" size="sm" variant="ghost" disabled={busy}>
                    <XIcon /> Reject
                  </Button>
                ) : null}
                {state === "live" || state === "scheduled" ? (
                  <Button type="submit" name="intent" value="end" size="sm" variant="destructive" disabled={busy}>
                    <SquareIcon /> Stop advert now
                  </Button>
                ) : null}
              </div>
            </Form>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminAds({ loaderData, actionData }: Route.ComponentProps) {
  const { ads, bands, filter, q } = loaderData;
  const [params] = useSearchParams();
  const tabHref = (t: string | null) => {
    const p = new URLSearchParams(params);
    if (t) p.set("status", t);
    else p.delete("status");
    return `?${p}`;
  };

  return (
    <>
      <PageHeader
        title="Adverts"
        description="Quote custom requests, check payments and approve adverts. Nothing is shown to shoppers until you approve it."
        actions={
          <Button asChild variant="outline">
            <Link to="/admin/ads/settings">Bands & payment details</Link>
          </Button>
        }
      />
      {actionData && "ok" in actionData ? (
        <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p>
      ) : null}
      <div className="mb-4">
        <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="scrollbar-none flex gap-1 overflow-x-auto">
          {TABS.map(([t, label]) => (
            <Link
              key={t ?? "all"}
              to={tabHref(t)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-sm font-semibold",
                filter === t ? "bg-foreground text-background" : "bg-muted hover:bg-muted/70",
              )}
            >
              {label}
            </Link>
          ))}
        </div>
        <Form className="ml-auto w-full sm:w-64">
          {filter ? <input type="hidden" name="status" value={filter} /> : null}
          <Input name="q" type="search" defaultValue={q} placeholder="Ad number, product, store, reference" className="h-9" />
        </Form>
      </div>

      {ads.length === 0 ? (
        <EmptyState icon={MegaphoneIcon} title="Nothing here">
          {filter ? `No adverts are "${TABS.find(([t]) => t === filter)?.[1] ?? AD_STATE_LABEL.live}".` : "No adverts yet."}
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {ads.map((ad) => (
            <AdCard key={ad.id} ad={ad} bands={bands} />
          ))}
        </div>
      )}
    </>
  );
}
