import { sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { cached, invalidate } from "./cache.server";

/** All admin-editable settings as a key/value map, cached briefly (it's a handful of rows). */
export function getSettings(): Promise<Record<string, string>> {
  return cached("settings", 30_000, async () => {
    const rows = await db.select().from(schema.settings);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });
}

export async function getSetting(key: string) {
  return (await getSettings())[key] ?? null;
}

export async function setSettings(values: Record<string, string>) {
  const rows = Object.entries(values).map(([key, value]) => ({ key, value }));
  if (!rows.length) return;
  await db
    .insert(schema.settings)
    .values(rows)
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: sql`excluded.value`, updatedAt: new Date() } });
  invalidate("settings");
}

/** Reads a whole number setting, falling back when it's missing or invalid. */
export function intSetting(all: Record<string, string>, key: string, fallback: number, min = 0) {
  const n = Number(all[key]);
  return Number.isInteger(n) && n >= min ? n : fallback;
}
