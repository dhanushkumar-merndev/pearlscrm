"use client";

import { QueryClientProvider } from "@tanstack/react-query";

import { appQueryClient, claimClinicalCache } from "@/lib/query-client";

/** Provides one user-scoped, memory-only TanStack Query cache for the app. */
export function QueryProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  claimClinicalCache(userId);

  return <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>;
}
