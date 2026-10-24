import { CarIcon, WrenchIcon } from "lucide-react";
import { Link } from "react-router";
import { BODY_TYPES, FUELS, MAKES, PART_CATEGORIES, TRANSMISSIONS } from "~/lib/auto";
import { cn } from "~/lib/utils";
import { Input, NativeSelect } from "./ui/input";

export type AutoFilterValues = {
  type?: "vehicle" | "part";
  make?: string;
  model?: string;
  yearFrom?: number;
  yearTo?: number;
  maxMileage?: number;
  transmission?: string;
  fuel?: string;
  bodyType?: string;
  partCategory?: string;
  fitMake?: string;
  fitModel?: string;
  fitYear?: number;
};

/** Reads the Auto filters from the address bar. */
export function autoFiltersFromParams(p: URLSearchParams): AutoFilterValues {
  const n = (k: string, min: number, max: number) => {
    const v = Number(p.get(k));
    return Number.isInteger(v) && v >= min && v <= max ? v : undefined;
  };
  const t = (k: string) => p.get(k)?.trim().slice(0, 60) || undefined;
  const type = p.get("autoType") === "part" ? "part" : p.get("autoType") === "vehicle" ? "vehicle" : undefined;
  return {
    type,
    make: MAKES.includes(String(p.get("make"))) ? String(p.get("make")) : undefined,
    model: t("model"),
    yearFrom: n("yearFrom", 1950, 2100),
    yearTo: n("yearTo", 1950, 2100),
    maxMileage: n("maxMileage", 1, 2_000_000),
    transmission: TRANSMISSIONS.some((x) => x.value === p.get("transmission")) ? String(p.get("transmission")) : undefined,
    fuel: FUELS.some((x) => x.value === p.get("fuel")) ? String(p.get("fuel")) : undefined,
    bodyType: BODY_TYPES.includes(String(p.get("bodyType"))) ? String(p.get("bodyType")) : undefined,
    partCategory: PART_CATEGORIES.includes(String(p.get("partCategory"))) ? String(p.get("partCategory")) : undefined,
    fitMake: MAKES.includes(String(p.get("fitMake"))) ? String(p.get("fitMake")) : undefined,
    fitModel: t("fitModel"),
    fitYear: n("fitYear", 1950, 2100),
  };
}

const MILEAGES = [30_000, 50_000, 80_000, 100_000, 150_000, 200_000];

/**
 * Vehicle / spare-part filters, inside the browse page's filter form (which submits on change).
 * The type tabs are links so switching clears the other type's filters.
 */
export function AutoFilterFields({ f, base }: { f: AutoFilterValues; base: string }) {
  const year = new Date().getFullYear();
  const years = Array.from({ length: 40 }, (_, i) => year + 1 - i);
  const tab = (value: "vehicle" | "part" | undefined, label: string, Icon?: typeof CarIcon) => (
    <Link
      to={`${base}${value ? `&autoType=${value}` : ""}`}
      className={cn("flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-semibold", f.type === value ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/40")}
    >
      {Icon ? <Icon className="size-4" /> : null}
      {label}
    </Link>
  );
  return (
    <div className="grid w-full gap-3 rounded-2xl border bg-card p-3">
      <div className="flex flex-wrap gap-2">
        {tab(undefined, "Everything in Auto")}
        {tab("vehicle", "Vehicles", CarIcon)}
        {tab("part", "Spare parts", WrenchIcon)}
      </div>
      {f.type ? <input type="hidden" name="autoType" value={f.type} /> : null}
      {f.type === "vehicle" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <NativeSelect name="make" defaultValue={f.make ?? ""} aria-label="Make">
            <option value="">Any make</option>
            {MAKES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </NativeSelect>
          <Input name="model" defaultValue={f.model ?? ""} placeholder="Model" aria-label="Model" />
          <NativeSelect name="yearFrom" defaultValue={f.yearFrom ?? ""} aria-label="Year from">
            <option value="">Year from</option>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </NativeSelect>
          <NativeSelect name="yearTo" defaultValue={f.yearTo ?? ""} aria-label="Year to">
            <option value="">Year to</option>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </NativeSelect>
          <NativeSelect name="maxMileage" defaultValue={f.maxMileage ?? ""} aria-label="Mileage">
            <option value="">Any mileage</option>
            {MILEAGES.map((m) => (
              <option key={m} value={m}>
                Under {m.toLocaleString("en-US")} km
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="transmission" defaultValue={f.transmission ?? ""} aria-label="Transmission">
            <option value="">Any gearbox</option>
            {TRANSMISSIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="fuel" defaultValue={f.fuel ?? ""} aria-label="Fuel">
            <option value="">Any fuel</option>
            {FUELS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="bodyType" defaultValue={f.bodyType ?? ""} aria-label="Body type">
            <option value="">Any body</option>
            {BODY_TYPES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </NativeSelect>
        </div>
      ) : f.type === "part" ? (
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <NativeSelect name="partCategory" defaultValue={f.partCategory ?? ""} aria-label="Part category">
              <option value="">Any part</option>
              {PART_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </NativeSelect>
          </div>
          <p className="text-sm font-semibold">Parts that fit my vehicle</p>
          <div className="grid grid-cols-3 gap-2 sm:max-w-xl">
            <NativeSelect name="fitMake" defaultValue={f.fitMake ?? ""} aria-label="My vehicle's make">
              <option value="">Make</option>
              {MAKES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </NativeSelect>
            <Input name="fitModel" defaultValue={f.fitModel ?? ""} placeholder="Model" aria-label="My vehicle's model" />
            <NativeSelect name="fitYear" defaultValue={f.fitYear ?? ""} aria-label="My vehicle's year">
              <option value="">Year</option>
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </NativeSelect>
          </div>
          <p className="text-xs text-muted-foreground">Tip: search a part number in the search bar, with or without dashes.</p>
        </div>
      ) : null}
    </div>
  );
}
