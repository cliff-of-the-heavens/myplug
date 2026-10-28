import { MapPinIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { MAX_ITEM_LOCATIONS } from "~/lib/locations";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * Where a product can be seen or collected. By default it's at the store's physical address; the
 * merchant can instead list one or more places (e.g. two branches). Submitted as `locations` fields.
 */
export function LocationFields({ initial, storeAddress }: { initial: string[]; storeAddress: string | null }) {
  const [custom, setCustom] = useState(initial.length > 0 || !storeAddress);
  const [rows, setRows] = useState(initial.length ? initial : [""]);
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-sm font-semibold">Item location</legend>
      <p className="-mt-1 text-xs text-muted-foreground">Shown to shoppers on the item's page only, not in search results.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            [false, "At my business address", storeAddress ?? "Add your physical address under Business info first"],
            [true, "Somewhere else", "One or more places, e.g. another branch or a warehouse"],
          ] as const
        ).map(([value, label, text]) => (
          <label
            key={label}
            className={cn(
              "flex cursor-pointer gap-2 rounded-xl border-2 p-3 text-sm transition-colors",
              custom === value ? "border-primary bg-primary/5" : "hover:border-primary/40",
              !value && !storeAddress && "pointer-events-none opacity-50",
            )}
          >
            <input type="radio" checked={custom === value} onChange={() => setCustom(value)} disabled={!value && !storeAddress} className="mt-0.5 accent-primary" />
            <span className="grid">
              <span className="font-semibold">{label}</span>
              <span className="text-xs text-muted-foreground">{text}</span>
            </span>
          </label>
        ))}
      </div>
      {custom ? (
        <div className="grid gap-2">
          {rows.map((value, i) => (
            <div key={i} className="flex items-center gap-2">
              <MapPinIcon className="size-4 shrink-0 text-muted-foreground" />
              <Input
                name="locations"
                value={value}
                maxLength={200}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? e.target.value : r)))}
                placeholder="e.g. Shop 4, Chichiri Mall, Blantyre"
              />
              {rows.length > 1 ? (
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove location" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Trash2Icon />
                </Button>
              ) : null}
            </div>
          ))}
          {rows.length < MAX_ITEM_LOCATIONS ? (
            <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setRows([...rows, ""])}>
              <PlusIcon /> Add another location
            </Button>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
