"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { useRealtime } from "@/hooks/use-realtime";

/** Bursts are collapsed into one refresh — saving six views fires many rows. */
const DEBOUNCE_MS = 400;

/**
 * Re-renders the current server route when watched rows change.
 *
 * Renders nothing. The change itself carries no data: the route re-runs its own
 * authorized queries, so a viewer can never see a row their policies would have
 * withheld.
 */
export function RealtimeRefresh({
  channel,
  tables,
}: {
  channel: string;
  tables: { table: string; filter?: string }[];
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), DEBOUNCE_MS);
  }, [router]);

  useRealtime({ channel, tables, onChange: refresh });

  return null;
}
