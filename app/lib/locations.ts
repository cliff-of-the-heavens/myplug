/** Most places one item can be listed at. */
export const MAX_ITEM_LOCATIONS = 10;

/** Cleans the submitted `locations` fields: trimmed, no blanks or repeats, capped. */
export function parseLocations(values: FormDataEntryValue[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const loc = String(v).trim().slice(0, 200);
    if (loc && !seen.has(loc.toLowerCase())) {
      seen.add(loc.toLowerCase());
      out.push(loc);
    }
  }
  return out.slice(0, MAX_ITEM_LOCATIONS);
}
