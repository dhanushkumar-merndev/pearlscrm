"use client";

/**
 * A small in-memory cache for data fetched by client components.
 *
 * Switching between case tabs unmounts and remounts the panels, so without this
 * every visit to a tab refetched what it had just shown. Entries live at module
 * scope, so they survive that remount but never survive a page load: a hard
 * refresh starts with an empty cache and fetches fresh, which is the escape
 * hatch a clinician expects.
 *
 * Nothing here is persisted. Clinical data must not be written to
 * localStorage — it would outlive the session and the sign-out.
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000;

type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();

export function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }

  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Drops entries whose key starts with `prefix`, or the whole cache when no
 * prefix is given. Called when a write lands or a realtime change arrives, so
 * the cache never serves data the database has already moved past.
 */
export function invalidateCached(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }

  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Read-through helper: cached value if fresh, otherwise fetch and store it. */
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== null) return cached;

  const value = await fetcher();
  setCached(key, value, ttlMs);

  return value;
}
