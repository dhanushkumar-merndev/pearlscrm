"use client";

import { appQueryClient, CLINICAL_CACHE_TIME_MS } from "@/lib/query-client";

/**
 * A small TanStack Query-backed, in-memory cache for data fetched by client
 * components.
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

const DEFAULT_TTL_MS = CLINICAL_CACHE_TIME_MS;

type Entry = { value: unknown; expiresAt: number };
const cacheKey = (key: string) => ["clinical-data", key] as const;
const pending = new Map<string, { promise: Promise<unknown>; version: number }>();
const versions = new Map<string, number>();

function invalidateKey(key: string): void {
  versions.set(key, (versions.get(key) ?? 0) + 1);
  pending.delete(key);
}

export function getCached<T>(key: string): T | null {
  const entry = appQueryClient.getQueryData<Entry>(cacheKey(key));
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    appQueryClient.removeQueries({ queryKey: cacheKey(key), exact: true });
    return null;
  }

  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
  appQueryClient.setQueryData<Entry>(cacheKey(key), { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Drops entries whose key starts with `prefix`, or the whole cache when no
 * prefix is given. Called when a write lands or a realtime change arrives, so
 * the cache never serves data the database has already moved past.
 */
export function invalidateCached(prefix?: string): void {
  if (!prefix) {
    appQueryClient.removeQueries({ queryKey: ["clinical-data"] });
    for (const key of new Set([...pending.keys(), ...versions.keys()])) invalidateKey(key);
    return;
  }

  for (const query of appQueryClient.getQueryCache().findAll({ queryKey: ["clinical-data"] })) {
    const key = query.queryKey[1];
    if (typeof key === "string" && key.startsWith(prefix)) {
      appQueryClient.removeQueries({ queryKey: query.queryKey, exact: true });
      invalidateKey(key);
    }
  }

  for (const key of pending.keys()) {
    if (key.startsWith(prefix)) invalidateKey(key);
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

  const version = versions.get(key) ?? 0;
  const existing = pending.get(key) as { promise: Promise<T>; version: number } | undefined;
  if (existing?.version === version) return existing.promise;

  const request = fetcher()
    .then((value) => {
      // A write may have invalidated this key while the request was in flight.
      // Never let that older response repopulate the cache after the write.
      if ((versions.get(key) ?? 0) === version) setCached(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      if (pending.get(key)?.promise === request) pending.delete(key);
    });

  pending.set(key, { promise: request, version });

  return request;
}
