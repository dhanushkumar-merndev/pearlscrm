import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/server/auth/session";

/**
 * Operational view of the upload-session table.
 *
 * A `PENDING` session older than the in-flight window means an object may be
 * sitting in Tigris that no clinical record points at. Counting them is what
 * turns "storage quietly grows" into something an administrator can see and act
 * on.
 */

export type UploadSessionStats = {
  pending: number;
  finalized: number;
  abandoned: number;
  /** `PENDING` and old enough that no finalize can still be in flight. */
  stale: number;
  oldestStaleAt: string | null;
};

const STALE_AFTER_MS = 2 * 60 * 1000;

export async function getUploadSessionStats(): Promise<UploadSessionStats> {
  await requirePermission("user:manage");

  const admin = createSupabaseAdminClient();
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const countFor = async (status: "PENDING" | "FINALIZED" | "ABANDONED") => {
    const { count, error } = await admin
      .from("image_upload_sessions")
      .select("id", { count: "exact", head: true })
      .eq("status", status);

    if (error) throw new AppError("INTERNAL", "Could not read upload session state.");
    return count ?? 0;
  };

  const [pending, finalized, abandoned] = await Promise.all([
    countFor("PENDING"),
    countFor("FINALIZED"),
    countFor("ABANDONED"),
  ]);

  const { data: stale, count: staleCount } = await admin
    .from("image_upload_sessions")
    .select("created_at", { count: "exact" })
    .eq("status", "PENDING")
    .lt("created_at", staleBefore)
    .order("created_at", { ascending: true })
    .limit(1)
    .returns<{ created_at: string }[]>();

  return {
    pending,
    finalized,
    abandoned,
    stale: staleCount ?? 0,
    oldestStaleAt: stale?.[0]?.created_at ?? null,
  };
}
