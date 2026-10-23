import { BadgeCheckIcon, BathIcon, BedDoubleIcon, CheckIcon, FileXIcon, GavelIcon, HandCoinsIcon, MapPinIcon, RulerIcon, XIcon } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import type { ListingType, PriceType, PropertyFeatures } from "~/db/schema";
import { date, money } from "~/lib/format";
import { FEATURE_FLAGS, LISTING_BADGE, needsTitleDeed, PRICE_TYPE_LABEL, priceSuffix, soldWord } from "~/lib/property";
import { cn } from "~/lib/utils";
import { AuthLink } from "./auth-dialog";
import { DealCountdown } from "./price";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Field, Input, Textarea } from "./ui/input";

export type PropertyInfo = {
  id: string;
  listingType: ListingType | null;
  priceType: PriceType | null;
  priceCents: number;
  biddingEndsAt: Date | string | null;
  titleDeed: boolean | null;
  propertyFeatures: PropertyFeatures | null;
  soldAt: Date | string | null;
  currency: string;
};

export type OfferState = {
  count: number;
  highestCents: number | null;
  reserveMet: boolean | null;
  mine: { id: string; amountCents: number; status: string; message: string | null } | null;
};

/** Price, terms, title deed and the offer/bid form for a real estate listing. */
export function PropertyPanel({ p, offers, viewer, error }: { p: PropertyInfo; offers: OfferState; viewer: "guest" | "customer" | "owner" | "other"; error?: string | null }) {
  const busy = useNavigation().state !== "idle";
  const t = p.listingType;
  const bidding = p.priceType === "reserve";
  const closed = bidding && (!p.biddingEndsAt || new Date(p.biddingEndsAt) <= new Date());
  const sold = !!p.soldAt;
  const mine = offers.mine?.status === "pending" ? offers.mine : null;
  const minBid = bidding ? Math.max(p.priceCents, (offers.highestCents ?? 0) + 100) : null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        {t ? <Badge variant="accent">{LISTING_BADGE[t]}</Badge> : null}
        {sold ? <Badge variant="destructive">{soldWord(t)}</Badge> : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        {bidding ? <span className="text-sm text-muted-foreground">Bids from</span> : null}
        <span className="text-4xl font-black text-primary">{money(p.priceCents, p.currency)}</span>
        <span className="text-lg text-muted-foreground">{priceSuffix(t)}</span>
        {p.priceType ? <Badge variant={p.priceType === "fixed" ? "muted" : "highlight"}>{PRICE_TYPE_LABEL[p.priceType]}</Badge> : null}
      </div>

      {needsTitleDeed(t) ? (
        <p className={cn("flex w-fit items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold", p.titleDeed ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive")}>
          {p.titleDeed ? <BadgeCheckIcon className="size-4" /> : <FileXIcon className="size-4" />}
          Title deed {p.titleDeed ? "available" : "not available"}
        </p>
      ) : null}

      {bidding ? (
        <div className="grid gap-1 rounded-xl bg-secondary/60 p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <GavelIcon className="size-4" />
            {closed ? `Bidding closed${p.biddingEndsAt ? ` on ${date(p.biddingEndsAt, true)}` : ""}` : <>Bidding ends {p.biddingEndsAt ? date(p.biddingEndsAt, true) : ""}</>}
            {!closed && p.biddingEndsAt ? <DealCountdown endsAt={p.biddingEndsAt} /> : null}
          </p>
          <p>
            {offers.count ? (
              <>
                Highest bid: <strong>{money(offers.highestCents ?? 0, p.currency)}</strong> · {offers.count} bidder{offers.count === 1 ? "" : "s"}
              </>
            ) : (
              "No bids yet."
            )}
          </p>
          {offers.reserveMet != null ? (
            <p className={offers.reserveMet ? "font-semibold text-success" : "text-muted-foreground"}>{offers.reserveMet ? "Reserve price met" : "Reserve price not yet met"}</p>
          ) : null}
        </div>
      ) : offers.count ? (
        <p className="text-sm text-muted-foreground">
          <HandCoinsIcon className="mr-1 inline size-4" />
          {offers.count} {offers.count === 1 ? "person has" : "people have"} shown interest.
        </p>
      ) : null}

      <div className="rounded-2xl border bg-card p-5">
        {error ? <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        {viewer === "owner" ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/sell/offers">See offers ({offers.count})</Link>
            </Button>
            {!sold ? (
              <Button asChild variant="outline">
                <Link to={`/sell/products/${p.id}`}>Edit listing</Link>
              </Button>
            ) : null}
          </div>
        ) : sold ? (
          <p className="text-sm">
            This property has been {soldWord(t).toLowerCase()}.
            {offers.mine?.status === "accepted" ? <strong className="text-success"> Your offer was accepted.</strong> : null}
          </p>
        ) : closed ? (
          <p className="text-sm">Bidding has closed. The seller is choosing a buyer{mine ? "; your bid is being considered" : ""}.</p>
        ) : viewer === "guest" ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">Sign in as a customer to {bidding ? "bid" : "make an offer"}.</p>
            <Button asChild size="lg">
              <AuthLink mode="login">Sign in to {bidding ? "bid" : "make an offer"}</AuthLink>
            </Button>
          </div>
        ) : viewer === "other" ? (
          <p className="text-sm text-muted-foreground">Offers can be made from customer accounts.</p>
        ) : (
          <Form method="post" className="grid gap-3" key={offers.mine?.amountCents ?? "new"}>
            <input type="hidden" name="intent" value="offer" />
            {mine ? (
              <p className="text-sm">
                Your {bidding ? "bid" : "offer"}: <strong>{money(mine.amountCents, p.currency)}</strong>
                {bidding && offers.highestCents === mine.amountCents ? <Badge variant="success" className="ml-2">Highest bid</Badge> : null}
              </p>
            ) : offers.mine?.status === "declined" ? (
              <p className="text-sm text-muted-foreground">The seller declined your last offer. You can make a new one.</p>
            ) : null}
            {p.priceType === "fixed" ? (
              <p className="text-sm">
                The price is fixed. Show the seller you'll pay <strong>{money(p.priceCents, p.currency)}</strong>
                {priceSuffix(t)}.
              </p>
            ) : (
              <Field label={bidding ? `Your bid (at least ${money(minBid!, p.currency)})` : t === "rental" ? "Monthly rent you're offering" : "Your offer"}>
                <Input name="amount" inputMode="decimal" required placeholder={bidding ? String(minBid! / 100) : String(p.priceCents / 100)} />
              </Field>
            )}
            <Field label="Message to the seller (optional)">
              <Textarea name="message" rows={2} maxLength={1000} defaultValue={mine?.message ?? ""} placeholder={t === "rental" ? "When you'd move in, how many people..." : "How you'll pay, when you can view it..."} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="lg" disabled={busy}>
                {p.priceType === "fixed" ? (mine ? "Update message" : "I'm interested") : bidding ? (mine ? "Raise my bid" : "Place bid") : mine ? "Change my offer" : "Make an offer"}
              </Button>
              {mine ? (
                <Button type="submit" name="intent" value="withdraw-offer" variant="ghost" formNoValidate disabled={busy}>
                  Withdraw
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              The seller decides who gets the property. Your email isn't shown to them; they can reply through MyPlug messages. Never pay a deposit before viewing the property and checking the documents.
            </p>
          </Form>
        )}
      </div>
    </div>
  );
}

/** Location, size, rooms and the feature checklist. */
export function PropertyFeaturesList({ type, f }: { type: ListingType | null; f: PropertyFeatures | null }) {
  if (!f || !type) return null;
  const flags = FEATURE_FLAGS.filter((x) => x.for.includes(type));
  return (
    <div className="grid gap-3">
      <h2 className="font-bold">Key features</h2>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {f.location ? (
          <span className="flex items-center gap-1.5">
            <MapPinIcon className="size-4 text-primary" /> {f.location}
          </span>
        ) : null}
        {f.plotSize ? (
          <span className="flex items-center gap-1.5">
            <RulerIcon className="size-4 text-primary" /> {f.plotSize}
          </span>
        ) : null}
        {f.bedrooms != null ? (
          <span className="flex items-center gap-1.5">
            <BedDoubleIcon className="size-4 text-primary" /> {f.bedrooms} bedroom{f.bedrooms === 1 ? "" : "s"}
          </span>
        ) : null}
        {f.bathrooms != null ? (
          <span className="flex items-center gap-1.5">
            <BathIcon className="size-4 text-primary" /> {f.bathrooms} bathroom{f.bathrooms === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
        {flags.map((x) => (
          <li key={x.key} className={cn("flex items-center gap-2", !f[x.key] && "text-muted-foreground")}>
            {f[x.key] ? <CheckIcon className="size-4 text-success" /> : <XIcon className="size-4" />}
            {x.label}
          </li>
        ))}
      </ul>
      {f.other ? <p className="text-sm whitespace-pre-line text-muted-foreground">{f.other}</p> : null}
    </div>
  );
}

/** Interior and exterior photo sections for houses. */
export function PropertyPhotos({ images, onPick }: { images: { url: string; section: string | null }[]; onPick: (url: string) => void }) {
  const groups = (["exterior", "interior"] as const).map((s) => ({ s, items: images.filter((i) => i.section === s) })).filter((g) => g.items.length);
  if (!groups.length) return null;
  return (
    <div className="grid gap-3">
      {groups.map((g) => (
        <div key={g.s} className="grid gap-1.5">
          <p className="text-sm font-semibold capitalize">{g.s}</p>
          <div className="scrollbar-none flex gap-2 overflow-x-auto">
            {g.items.map((i) => (
              <button key={i.url} type="button" onClick={() => onPick(i.url)} className="size-20 shrink-0 overflow-hidden rounded-lg border">
                <img src={i.url} alt={`${g.s} photo`} className="size-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
