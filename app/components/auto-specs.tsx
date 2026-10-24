import { CheckIcon } from "lucide-react";
import { autoSpecRows, fitYears, type AutoDetails } from "~/lib/auto";

/** The vehicle spec sheet (or spare-part details and the vehicles it fits) on the product page. */
export function AutoSpecs({ a }: { a: AutoDetails }) {
  const rows = autoSpecRows(a);
  return (
    <div className="grid gap-3">
      <h2 className="font-bold">{a.type === "vehicle" ? "Specifications" : "Part details"}</h2>
      <dl className="grid overflow-hidden rounded-xl border text-sm sm:grid-cols-2">
        {rows.map(([k, v], i) => (
          <div key={k} className={`grid grid-cols-[9rem_1fr] gap-2 px-3 py-2 ${i % 4 < 2 ? "bg-muted/50" : ""}`}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {a.type === "vehicle" && a.features?.length ? (
        <ul className="grid grid-cols-2 gap-1.5 text-sm sm:grid-cols-3">
          {a.features.map((f) => (
            <li key={f} className="flex items-center gap-1.5">
              <CheckIcon className="size-4 text-success" /> {f}
            </li>
          ))}
        </ul>
      ) : null}
      {a.type === "part" && a.fits?.length ? (
        <div className="grid gap-1">
          <p className="text-sm font-semibold">Fits</p>
          <ul className="grid gap-1 text-sm">
            {a.fits.map((f, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <CheckIcon className="size-4 text-success" />
                {f.make} {f.model}
                {fitYears(f)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Check the part number against your vehicle before you buy, or ask the seller.</p>
        </div>
      ) : null}
    </div>
  );
}
