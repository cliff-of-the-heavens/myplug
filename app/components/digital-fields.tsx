import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import type { MediaType } from "~/db/schema";
import { MEDIA_LABEL, MEDIA_TYPES, offerTerms } from "~/lib/digital";
import { currencySymbol } from "~/lib/format";
import { MediaUploadField } from "./media-upload";
import { Button } from "./ui/button";
import { Field, Input, NativeSelect } from "./ui/input";

type Offer = { label: string; mode: "download" | "stream"; priceCents: number; accessDays: number | null; maxViews: number | null };
type Row = { label: string; mode: "download" | "stream"; price: string; days: string; views: string };

const STARTER: Row[] = [
  { label: "Download", mode: "download", price: "", days: "", views: "" },
  { label: "Watch online · 48 hours", mode: "stream", price: "", days: "2", views: "" },
];

/** Digital product: the kind of file, the private full file, a public preview, and price options. */
export function DigitalFields({
  mediaType,
  offers,
  hasMedia,
  previewUrl,
  direct,
  currency,
}: {
  mediaType: MediaType;
  offers: Offer[];
  hasMedia: boolean;
  previewUrl: string | null;
  direct: boolean;
  currency: string;
}) {
  const [type, setType] = useState<MediaType>(mediaType);
  const [rows, setRows] = useState<Row[]>(
    offers.length
      ? offers.map((o) => ({ label: o.label, mode: o.mode, price: String(o.priceCents / 100), days: o.accessDays ? String(o.accessDays) : "", views: o.maxViews ? String(o.maxViews) : "" }))
      : STARTER,
  );
  const set = (i: number, patch: Partial<Row>) => setRows((l) => l.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="grid gap-4 rounded-xl border-2 border-dashed p-4">
      <Field label="Kind of file">
        <NativeSelect name="mediaType" value={type} onChange={(e) => setType(e.target.value as MediaType)}>
          {(Object.keys(MEDIA_LABEL) as MediaType[]).map((t) => (
            <option key={t} value={t}>{MEDIA_LABEL[t]}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Full file (what buyers get)" hint="Stored privately. Buyers only reach it through their library, within the limits you set.">
        <MediaUploadField name="mediaFile" keyName="mediaKey" direct={direct} accept={MEDIA_TYPES[type]} visibility="private" current={hasMedia ? "yes" : null} />
      </Field>
      <Field label="Free preview (recommended)" hint="A trailer, a short clip or the first pages. Anyone can view it.">
        <MediaUploadField name="previewFile" keyName="previewUrl" direct={direct} accept={MEDIA_TYPES[type]} visibility="public" current={previewUrl} />
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Price options</legend>
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-lg bg-muted/50 p-2 sm:grid-cols-[1fr_8rem_7rem_6rem_6rem_auto] sm:items-end">
            <Field label="Name"><Input name="offerLabel" value={r.label} onChange={(e) => set(i, { label: e.target.value })} className="h-9" /></Field>
            <Field label="Type">
              <NativeSelect name="offerMode" value={r.mode} onChange={(e) => set(i, { mode: e.target.value as Row["mode"] })} className="h-9">
                <option value="download">Download</option>
                <option value="stream">Online only</option>
              </NativeSelect>
            </Field>
            <Field label={`Price (${currencySymbol(currency)})`}><Input name="offerPrice" inputMode="decimal" value={r.price} onChange={(e) => set(i, { price: e.target.value })} className="h-9" /></Field>
            <Field label="Days"><Input name="offerDays" type="number" min={0} placeholder="∞" value={r.days} onChange={(e) => set(i, { days: e.target.value })} className="h-9" /></Field>
            <Field label="Views">
              <Input name="offerViews" type="number" min={0} placeholder="∞" value={r.mode === "download" ? "" : r.views} readOnly={r.mode === "download"} onChange={(e) => set(i, { views: e.target.value })} className="h-9" />
            </Field>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove option" onClick={() => setRows((l) => l.filter((_, j) => j !== i))}><Trash2Icon /></Button>
            <p className="text-xs text-muted-foreground sm:col-span-6">
              Buyer gets: {offerTerms({ mode: r.mode, accessDays: Number(r.days) || null, maxViews: Number(r.views) || null }, type)}
            </p>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setRows((l) => [...l, { label: "", mode: "stream", price: "", days: "", views: "" }])}>
          <PlusIcon /> Add a price option
        </Button>
        <p className="text-xs text-muted-foreground">
          Leave Days empty for no time limit. Views limits how many times an online-only purchase can be opened. Buyers pay you
          first; access starts when you mark the payment received.
        </p>
      </fieldset>
    </div>
  );
}
