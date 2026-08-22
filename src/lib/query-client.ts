"use client";

import { QueryClient } from "@tanstack/react-query";

/**
 * Browser-memory cache only. It is intentionally never persisted to disk:
 * clinical data must disappear on a hard refresh and after a new user signs in.
 */
export const CLINICAL_CACHE_TIME_MS = 60 * 60 * 1000;

export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: CLINICAL_CACHE_TIME_MS,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

let cacheOwnerId: string | null = null;

/** Never let a new signed-in user inherit another user's in-memory data. */
export function claimClinicalCache(userId: string): void {
  if (cacheOwnerId !== userId) {
    appQueryClient.clear();
    cacheOwnerId = userId;
  }
}
