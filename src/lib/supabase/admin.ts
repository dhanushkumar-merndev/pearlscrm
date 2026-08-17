import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env/public";
import { serverEnv } from "@/lib/env/server";

let cached: SupabaseClient | undefined;

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for privileged server operations that have already authenticated and
 * authorized the caller themselves: user administration, SECURITY DEFINER RPCs,
 * and upload-session bookkeeping. Never reachable from the browser.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  if (cached) return cached;

  cached = createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return cached;
}
