import { useState } from "react";
import type { ListingType, PriceType, PropertyFeatures } from "~/db/schema";
import { currencySymbol } from "~/lib/format";
import { FEATURE_FLAGS, LISTING_TYPES, needsTitleDeed, PRICE_TYPES } from "~/lib/property";
import { cn } from "~/lib/utils";
import { DateTimeField } from "./datetime-field";
import { GalleryField } from "./gallery-field";
import { Field, Input, Textarea } from "./ui/input";

export type PropertyDefaults = {
  listingType: ListingType | null;
  priceType: PriceType | null;
  priceCents: number | null;
  reservePriceCents: number | null;
  biddingEndsAt: Date | string | null;
  titleDeed: boolean | null;
  propertyFeatures: PropertyFeatures | null;
  description: string;
  images: { url: string; section: string | null }[];
  hasOffers: boolean;
};

const cents = (c: number | null | undefined) => (c != null ? (c / 100).toFixed(2) : "");

function Choice<T extends string>({ name, value, current, onPick, label, text }: { name: string; value: T; current: T; onPick: (v: T) => void; label: string; text: string }) {
  return (
    <label className={cn("flex cursor-pointer gap-2 rounded-xl border-2 p-3 text-sm transition-colors", current === value ? "border-primary bg-primary/5" : "hover:border-primary/40")}>
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => onPick(value)} className="mt-0.5 accent-primary" />
      <span className="grid">
        <span className="font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">{text}</span>
      </span>
    </label>
  );
}

/** Real estate part of the listing form: type, price terms, title deed, features and photos. */
export function PropertyFields({ d, currency, max }: { d: PropertyDefaults; currency: string; max: number }) {
  const [type, setType] = useState<ListingType>(d.listingType ?? "house");
  const [priceType, setPriceType] = useState<PriceType>(d.priceType ?? "negotiable");
  const [deed, setDeed] = useState<"yes" | "no" | "">(d.titleDeed === true ? "yes" : d.titleDeed === false ? "no" : "");
  const f = d.propertyFeatures ?? {};
  const effectivePrice = type === "rental" && priceType === "reserve" ? "negotiable" : priceType;
  const sym = currencySymbol(currency);

  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="mb-1.5 text-sm font-semibold">Type of property listing</legend>
        {LISTING_TYPES.map((t) => (
          <Choice key={t.value} name="listingType" value={t.value} current={type} onPick={setType} label={t.label} text={t.text} />
        ))}
      </fieldset>

      <Field label={type === "land" ? "Description (the main information buyers read)" : "Description"} hint={type === "land" ? "Size, access road, soil, utilities nearby, zoning, what it suits (home, farm, business)..." : undefined}>
        <Textarea name="description" rows={type === "land" ? 8 : 5} required minLength={30} maxLength={5000} defaultValue={d.description} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Location" hint="Area and town, e.g. Area 43, Lilongwe">
          <Input name="location" required maxLength={200} defaultValue={f.location ?? ""} />
        </Field>
        <Field label={type === "land" ? "Plot size" : "Plot size (optional)"} hint="e.g. 50 × 30 m, or 1 acre">
          <Input name="plotSize" maxLength={60} required={type === "land"} defaultValue={f.plotSize ?? ""} />
        </Field>
      </div>

      {needsTitleDeed(type) ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-sm font-semibold">Title deed</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice name="titleDeed" value="yes" current={deed} onPick={setDeed} label="Available" text="The title deed is ready to transfer" />
            <Choice name="titleDeed" value="no" current={deed} onPick={setDeed} label="Not available" text="e.g. still being processed, or customary land" />
          </div>
        </fieldset>
      ) : null}

      {type !== "land" ? (
        <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
          <Field label="Bedrooms">
            <Input name="bedrooms" type="number" min={0} max={50} required defaultValue={f.bedrooms ?? ""} />
          </Field>
          <Field label="Bathrooms">
            <Input name="bathrooms" type="number" min={0} max={50} required defaultValue={f.bathrooms ?? ""} />
          </Field>
        </div>
      ) : null}

      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-semibold">Key features</legend>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {FEATURE_FLAGS.filter((x) => x.for.includes(type)).map((x) => (
            <label key={x.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={x.key} defaultChecked={!!f[x.key]} className="size-4 accent-primary" />
              {x.label}
            </label>
          ))}
        </div>
        <Field label="Other features (optional)">
          <Textarea name="otherFeatures" rows={2} maxLength={1000} defaultValue={f.other ?? ""} placeholder="e.g. tiled throughout, fitted kitchen, 10 minutes from the city centre" />
        </Field>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-semibold">Price</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PRICE_TYPES.filter((p) => type !== "rental" || p.value !== "reserve").map((p) => (
            <Choice key={p.value} name="priceType" value={p.value} current={effectivePrice} onPick={setPriceType} label={p.label} text={p.text} />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={type === "rental" ? `Monthly rent (${sym})` : effectivePrice === "reserve" ? `Opening bid (${sym})` : `Asking price (${sym})`}>
            <Input name="price" required inputMode="decimal" defaultValue={cents(d.priceCents)} />
          </Field>
          {effectivePrice === "reserve" ? (
            <>
              <Field label={`Reserve price (${sym})`} hint="Secret: buyers only see whether it's been met">
                <Input name="reservePrice" required inputMode="decimal" defaultValue={cents(d.reservePriceCents)} />
              </Field>
              <Field label="Bidding ends" hint={d.hasOffers ? "Bids exist: you can only extend it" : "Your local time"}>
                <DateTimeField name="biddingEndsAt" required defaultValue={d.biddingEndsAt} />
              </Field>
            </>
          ) : null}
        </div>
      </fieldset>

      {type === "land" ? (
        <Field label="Photos (optional)" hint={`Up to ${max}. Drag & drop several at once.`}>
          <GalleryField name="gallery" initial={d.images.map((i) => i.url)} max={max} />
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Exterior photos" hint="Front, garden, gate, the street">
            <GalleryField name="galleryExterior" initial={d.images.filter((i) => i.section === "exterior").map((i) => i.url)} max={max} />
          </Field>
          <Field label="Interior photos" hint="Lounge, kitchen, bedrooms, bathrooms">
            <GalleryField name="galleryInterior" initial={d.images.filter((i) => i.section === "interior").map((i) => i.url)} max={max} />
          </Field>
        </div>
      )}
    </div>
  );
}
