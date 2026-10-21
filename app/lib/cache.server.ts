/**
 * Tiny in-memory cache for data that rarely changes and is read on almost every
 * request (categories, settings). Each server instance keeps its own copy for a
 * short time, which takes most of that read traffic off the database under load.
 * After an admin changes something, the instance that saved it sees the change at
 * once; other instances within `ttlMs`.
 */
const entries = new Map<string, { value: unknown; expires: number; pending?: Promise<unknown> }>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  if (hit?.pending) return hit.pending as Promise<T>; // many requests at once share one database read

  const pending = load().then(
    (value) => {
      entries.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    },
    (error) => {
      entries.delete(key);
      throw error;
    },
  );
  entries.set(key, { value: hit?.value, expires: 0, pending });
  return pending;
}

export function invalidate(prefix: string) {
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
}
