/**
 * Per-instance memo for read-heavy results that only change with the pipeline (Turso bills rows read).
 * A warm function instance answers from memory for `ttlMs`; concurrent callers share one query, and a
 * failed query is not kept. Each instance holds its own copy, so a cold start reads once.
 */
const entries = new Map<string, { expires: number; value: Promise<unknown> }>();
/** Pools are keyed by filters (pool × mode × genre × difficulty × player), so the oldest are dropped past this. */
const MAX_ENTRIES = 200;

/** Catalog lists (autocomplete, facets, health): change only when the pipeline runs. */
export const CATALOG_TTL_MS = 10 * 60_000;
/** Puzzle pools: also follow a player's /api/sync, so they refresh sooner. */
export const POOL_TTL_MS = 5 * 60_000;

export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  const value = load();
  entries.delete(key);
  entries.set(key, { expires: now + ttlMs, value });
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return value;
}
