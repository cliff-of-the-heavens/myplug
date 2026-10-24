import { CarIcon, PlusIcon, WrenchIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { BODY_TYPES, CONDITIONS, DRIVES, FUELS, MAKES, PART_CATEGORIES, POPULAR_MODELS, TRANSMISSIONS, VEHICLE_FEATURES, type AutoDetails, type AutoType, type PartFit } from "~/lib/auto";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Field, Input, NativeSelect } from "./ui/input";

function YesNo({ name, label, value, yes, no }: { name: string; label: string; value: boolean | undefined; yes: string; no: string }) {
  return (
    <Field label={label}>
      <NativeSelect name={name} defaultValue={value === true ? "yes" : value === false ? "no" : ""}>
        <option value="">Not stated</option>
        <option value="yes">{yes}</option>
        <option value="no">{no}</option>
      </NativeSelect>
    </Field>
  );
}

/** Vehicle spec sheet or spare-part details, for listings in the Auto category. */
export function AutoFields({ d }: { d: AutoDetails | null }) {
  const [type, setType] = useState<AutoType>(d?.type ?? "vehicle");
  const [make, setMake] = useState(d?.make ?? "");
  const [fits, setFits] = useState<PartFit[]>(d?.fits?.length ? d.fits : [{ make: "", model: "" }]);
  const year = new Date().getFullYear();

  return (
    <div className="grid gap-4 rounded-2xl border-2 border-primary/20 bg-primary/5 p-4">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-1.5 text-sm font-semibold">Auto listing</legend>
        {(
          [
            ["vehicle", "A vehicle", "Car, pickup, truck, bus, motorbike", CarIcon],
            ["part", "A spare part", "With part numbers and the vehicles it fits", WrenchIcon],
          ] as const
        ).map(([value, label, text, Icon]) => (
          <label key={value} className={cn("flex cursor-pointer gap-2 rounded-xl border-2 bg-card p-3 text-sm", type === value ? "border-primary" : "hover:border-primary/40")}>
            <input type="radio" name="autoType" value={value} checked={type === value} onChange={() => setType(value)} className="mt-0.5 accent-primary" />
            <Icon className="mt-0.5 size-4 text-primary" />
            <span className="grid">
              <span className="font-semibold">{label}</span>
              <span className="text-xs text-muted-foreground">{text}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {type === "vehicle" ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Make">
              <NativeSelect name="make" required value={make} onChange={(e) => setMake(e.target.value)}>
                <option value="">Choose…</option>
                {MAKES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Model">
              <Input name="model" required list="auto-models" maxLength={80} defaultValue={d?.model ?? ""} placeholder="e.g. Vitz" />
              <datalist id="auto-models">
                {(POPULAR_MODELS[make] ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
            <Field label="Grade / trim">
              <Input name="grade" maxLength={80} defaultValue={d?.grade ?? ""} placeholder="e.g. F, Hybrid G" />
            </Field>
            <Field label="Year">
              <Input name="year" type="number" required min={1950} max={year + 1} defaultValue={d?.year ?? ""} />
            </Field>
            <Field label="Mileage (km)">
              <Input name="mileageKm" inputMode="numeric" defaultValue={d?.mileageKm ?? ""} placeholder="e.g. 68000" />
            </Field>
            <Field label="Engine (cc)">
              <Input name="engineCc" inputMode="numeric" defaultValue={d?.engineCc ?? ""} placeholder="e.g. 1300" />
            </Field>
            <Field label="Transmission">
              <NativeSelect name="transmission" defaultValue={d?.transmission ?? ""}>
                <option value="">—</option>
                {TRANSMISSIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Fuel">
              <NativeSelect name="fuel" defaultValue={d?.fuel ?? ""}>
                <option value="">—</option>
                {FUELS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Drive">
              <NativeSelect name="drive" defaultValue={d?.drive ?? ""}>
                <option value="">—</option>
                {DRIVES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Steering">
              <NativeSelect name="steering" defaultValue={d?.steering ?? "right"}>
                <option value="right">Right-hand drive</option>
                <option value="left">Left-hand drive</option>
              </NativeSelect>
            </Field>
            <Field label="Body type">
              <NativeSelect name="bodyType" defaultValue={d?.bodyType ?? ""}>
                <option value="">—</option>
                {BODY_TYPES.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Colour">
              <Input name="colour" maxLength={40} defaultValue={d?.colour ?? ""} />
            </Field>
            <Field label="Seats">
              <Input name="seats" type="number" min={1} max={100} defaultValue={d?.seats ?? ""} />
            </Field>
            <Field label="Doors">
              <Input name="doors" type="number" min={0} max={10} defaultValue={d?.doors ?? ""} />
            </Field>
            <Field label="Chassis no. (last 6)" hint="Never the full number">
              <Input name="chassisEnding" maxLength={8} defaultValue={d?.chassisEnding ?? ""} placeholder="e.g. 123456" />
            </Field>
            <Field label="Condition">
              <NativeSelect name="autoCondition" defaultValue={d?.condition ?? "used"}>
                {CONDITIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <YesNo name="dutyPaid" label="Duty" value={d?.dutyPaid} yes="Duty paid, registered" no="Duty not paid" />
            <YesNo name="inCountry" label="Availability" value={d?.inCountry} yes="In the country" no="Being imported" />
            <Field label="Location" className="col-span-2">
              <Input name="autoLocation" maxLength={120} defaultValue={d?.location ?? ""} placeholder="e.g. Kanengo, Lilongwe" />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">Features</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
              {VEHICLE_FEATURES.map((f) => (
                <label key={f} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="vehicleFeature" value={f} defaultChecked={d?.features?.includes(f)} className="size-4 accent-primary" />
                  {f}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Part category">
              <NativeSelect name="partCategory" required defaultValue={d?.partCategory ?? ""}>
                <option value="">Choose…</option>
                {PART_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Part number" hint="As printed on the part">
              <Input name="partNumber" maxLength={40} defaultValue={d?.partNumber ?? ""} placeholder="e.g. 04465-02220" />
            </Field>
            <Field label="OEM number">
              <Input name="oemNumber" maxLength={40} defaultValue={d?.oemNumber ?? ""} />
            </Field>
            <Field label="Brand">
              <Input name="brand" maxLength={40} defaultValue={d?.brand ?? ""} placeholder="e.g. Toyota Genuine, Bosch" />
            </Field>
            <Field label="Position">
              <Input name="position" maxLength={40} defaultValue={d?.position ?? ""} placeholder="e.g. Front, left" />
            </Field>
            <Field label="Condition">
              <NativeSelect name="autoCondition" defaultValue={d?.condition ?? "new"}>
                {CONDITIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Location" className="col-span-2 sm:col-span-3">
              <Input name="autoLocation" maxLength={120} defaultValue={d?.location ?? ""} />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">Fits these vehicles</legend>
            {fits.map((f, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_5rem_5rem_auto] items-center gap-2">
                <NativeSelect name="fitMake" defaultValue={f.make} aria-label="Make">
                  <option value="">Make</option>
                  {MAKES.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </NativeSelect>
                <Input name="fitModel" defaultValue={f.model} placeholder="Model" aria-label="Model" maxLength={60} />
                <Input name="fitFrom" type="number" min={1950} max={year + 1} defaultValue={f.yearFrom ?? ""} placeholder="From" aria-label="Year from" />
                <Input name="fitTo" type="number" min={1950} max={year + 1} defaultValue={f.yearTo ?? ""} placeholder="To" aria-label="Year to" />
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setFits((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : x))}>
                  <XIcon />
                </Button>
              </div>
            ))}
            {fits.length < 10 ? (
              <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setFits((x) => [...x, { make: "", model: "" }])}>
                <PlusIcon /> Add another vehicle
              </Button>
            ) : null}
          </fieldset>
        </>
      )}
    </div>
  );
}
