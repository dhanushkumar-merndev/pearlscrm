"use client";

import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to Postgres changes on a set of tables and calls back when one
 * lands.
 *
 * Deliberately does *not* use the payload. A change notification only says
 * "something you can see has changed"; the component then re-reads through its
 * normal authorized query. That keeps clinical values out of the realtime
 * stream and means a subscriber can never render a row it would not have been
 * allowed to fetch.
 *
 * `onChange` is held in a ref so a caller can pass an inline function without
 * tearing down and rebuilding the channel on every render.
 */
export function useRealtime(params: {
  /** Stable, unique channel name. Two channels cannot share one name. */
  channel: string;
  tables: { table: string; filter?: string }[];
  onChange: () => void;
  enabled?: boolean;
}) {
  const { channel, tables, enabled = true } = params;

  const onChangeRef = useRef(params.onChange);

  useEffect(() => {
    onChangeRef.current = params.onChange;
  });

  // The table list is usually an inline array; comparing its content rather
  // than its identity keeps the subscription stable across renders.
  const signature = JSON.stringify(tables);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    const subscription = supabase.channel(channel);
    const targets = JSON.parse(signature) as { table: string; filter?: string }[];

    for (const target of targets) {
      subscription.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: target.table,
          ...(target.filter ? { filter: target.filter } : {}),
        },
        () => onChangeRef.current(),
      );
    }

    subscription.subscribe();

    return () => {
      void supabase.removeChannel(subscription);
    };
  }, [channel, signature, enabled]);
}
