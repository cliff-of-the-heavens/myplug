import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { ASPECT_TOLERANCE, formatList, MIN_WIDTH_RATIO, PREPARATION_TIPS } from "~/lib/banners";
import { money } from "~/lib/format";
import { cn } from "~/lib/utils";
import { ImageDropzone } from "./image-dropzone";
import { Field, Input } from "./ui/input";

export type PlacementInfo = {
  key: string;
  name: string;
  description: string;
  width: number;
  height: number;
  maxKb: number;
  formats: string;
  weeklyCents: number;
  maxActive: number;
  hideableWithPass: boolean;
};

const FORMAT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

/** The ad spots with their exact sizes, limits and weekly price. */
export function PlacementTable({ placements, currency = "MWK" }: { placements: PlacementInfo[]; currency?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {placements.map((p) => (
        <div key={p.key} className="grid content-start gap-2 rounded-2xl border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold">{p.name}</h3>
            <span className="shrink-0 text-sm font-extrabold text-primary">{money(p.weeklyCents, currency)}/week</span>
          </div>
          <PlacementShape p={p} />
          <p className="text-sm text-muted-foreground">{p.description}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs">
            <dt className="text-muted-foreground">Size</dt>
            <dd className="font-semibold">
              {p.width} × {p.height} px
            </dd>
            <dt className="text-muted-foreground">Format</dt>
            <dd>{formatList(p.formats)}</dd>
            <dt className="text-muted-foreground">File size</dt>
            <dd>up to {p.maxKb} KB</dd>
            <dt className="text-muted-foreground">Rotation</dt>
            <dd>shares the spot with up to {p.maxActive - 1} other ad{p.maxActive - 1 === 1 ? "" : "s"}</dd>
          </dl>
        </div>
      ))}
    </div>
  );
}

/** A to-scale outline of the banner shape. */
function PlacementShape({ p }: { p: PlacementInfo }) {
  const tall = p.height > p.width;
  return (
    <div className={cn("flex items-center justify-center rounded-lg bg-muted/60 p-2", tall ? "h-28" : "h-16")}>
      <div
        className="flex items-center justify-center rounded border-2 border-dashed border-primary/50 text-[10px] font-semibold text-primary"
        style={tall ? { height: "100%", aspectRatio: `${p.width}/${p.height}` } : { width: "100%", aspectRatio: `${p.width}/${p.height}`, maxHeight: "100%" }}
      >
        {p.width}×{p.height}
      </div>
    </div>
  );
}

export function PreparationTips() {
  return (
    <ul className="grid gap-2 text-sm">
      {PREPARATION_TIPS.map((t) => (
        <li key={t} className="flex gap-2">
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** Checks the chosen image in the browser, before upload, against the spot's specs. */
function useCreativeCheck(p: PlacementInfo | undefined) {
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const check = (file: File | undefined) => {
    if (!file || !p) return setResult(null);
    const kb = Math.ceil(file.size / 1024);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const want = p.width / p.height;
      const problems = [];
      if (kb > p.maxKb) problems.push(`it's ${kb} KB (limit ${p.maxKb} KB)`);
      if (Math.abs(w / h - want) / want > ASPECT_TOLERANCE) problems.push(`it's ${w}×${h}px, the wrong shape`);
      else if (w < p.width * MIN_WIDTH_RATIO) problems.push(`it's only ${w}px wide`);
      setResult(problems.length ? { ok: false, text: `This won't be accepted: ${problems.join(", ")}. Use ${p.width}×${p.height}px.` } : { ok: true, text: `${w}×${h}px, ${kb} KB: looks good.` });
    };
    img.onerror = () => setResult({ ok: false, text: "That file couldn't be read as an image." });
    img.src = url;
  };
  return { result, check };
}

/** Banner image (checked as you pick it), headline and click-through link. */
export function CreativeFields({
  placement,
  required,
  defaults,
}: {
  placement: PlacementInfo | undefined;
  required?: boolean;
  defaults?: { headline?: string | null; linkUrl?: string | null; preview?: string | null };
}) {
  const { result, check } = useCreativeCheck(placement);
  const types = (placement?.formats ?? "jpg,png,webp")
    .split(",")
    .map((f) => FORMAT_TYPES[f.trim()])
    .filter(Boolean);
  return (
    <div className="grid gap-4">
      <Field label="Banner image" hint={placement ? `${placement.width}×${placement.height}px · ${formatList(placement.formats)} · up to ${placement.maxKb} KB` : undefined}>
        <ImageDropzone
            onFile={(f) => check(f ?? undefined)}
            key={placement?.key}
            name="creative"
            required={required}
            types={types}
            defaultPreview={defaults?.preview ?? null}
            prompt="Add banner"
            hint="Drag & drop or click"
            className="min-h-32"
            imgClassName="max-h-48 w-full object-contain"
          />
        {result ? (
          <p className={cn("flex items-center gap-1.5 text-xs font-medium", result.ok ? "text-success" : "text-destructive")}>
            {result.ok ? <CheckCircle2Icon className="size-3.5" /> : <TriangleAlertIcon className="size-3.5" />} {result.text}
          </p>
        ) : null}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Headline" hint="Short description; also read aloud to blind visitors">
          <Input name="headline" maxLength={80} defaultValue={defaults?.headline ?? ""} placeholder="e.g. Back-to-school shoes, 20% off" />
        </Field>
        <Field label="Where clicks go (optional)" hint="Your MyPlug store (e.g. /s/my-shop) or an https:// website">
          <Input name="linkUrl" maxLength={500} defaultValue={defaults?.linkUrl ?? ""} placeholder="/s/my-shop" />
        </Field>
      </div>
    </div>
  );
}
