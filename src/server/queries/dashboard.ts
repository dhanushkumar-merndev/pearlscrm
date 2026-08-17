import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors";
import { todayIsoDate, daysBetween } from "@/lib/dates";
import type { CaseListRow } from "@/lib/types";

/**
 * Dashboard read model.
 *
 * Every number here comes from a real database count. Nothing on the dashboard
 * is hardcoded or approximated.
 */

export type DashboardMetrics = {
  totalCases: number;
  activeFollowups: number;
  awaitingReview: number;
  completedCases: number;
  incompleteCases: number;
};

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const supabase = await createSupabaseServerClient();

  /** `head: true` fetches the count only — no rows cross the wire. */
  const activeCases = () =>
    supabase.from("case_list_view").select("id", { count: "exact", head: true }).is("archived_at", null);

  const [total, followups, awaiting, completed] = await Promise.all([
    activeCases(),
    activeCases().gt("followup_count", 0).eq("status", "ACTIVE"),
    activeCases().neq("review_status", "COMPLETED"),
    activeCases().eq("status", "COMPLETED"),
  ]);

  for (const result of [total, followups, awaiting, completed]) {
    if (result.error) throw new AppError("INTERNAL", "Could not load dashboard metrics.");
  }

  const totalCases = total.count ?? 0;
  const completedCases = completed.count ?? 0;

  return {
    totalCases,
    activeFollowups: followups.count ?? 0,
    awaitingReview: awaiting.count ?? 0,
    completedCases,
    incompleteCases: Math.max(0, totalCases - completedCases),
  };
}

export async function getRecentCases(limit = 8): Promise<CaseListRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("case_list_view")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<CaseListRow[]>();

  if (error) throw new AppError("INTERNAL", "Could not load recent cases.");

  return data ?? [];
}

export type FollowupAttentionRow = CaseListRow & {
  daysSinceLastActivity: number;
  reason: string;
};

/**
 * Cases whose follow-up history suggests a visit may be due.
 *
 * Purely a prompt for the clinic to review — it is derived from surgery and
 * visit dates, and makes no clinical recommendation.
 */
export async function getFollowupAttention(limit = 8): Promise<FollowupAttentionRow[]> {
  const supabase = await createSupabaseServerClient();
  const today = todayIsoDate();

  const { data, error } = await supabase
    .from("case_list_view")
    .select("*")
    .is("archived_at", null)
    .eq("status", "ACTIVE")
    .lte("surgery_date", today)
    .order("surgery_date", { ascending: true })
    .limit(200)
    .returns<CaseListRow[]>();

  if (error) throw new AppError("INTERNAL", "Could not load follow-up attention.");

  return (data ?? [])
    .map((row) => {
      const lastActivity = row.latest_followup_date ?? row.surgery_date;
      const days = daysBetween(lastActivity, today);

      return {
        ...row,
        daysSinceLastActivity: days,
        reason:
          row.followup_count === 0
            ? "No follow-up recorded since surgery"
            : `No follow-up recorded since ${row.latest_followup_label ?? "the last visit"}`,
      };
    })
    // ~1 month past the last recorded activity is the first point a follow-up
    // could plausibly be outstanding.
    .filter((row) => row.daysSinceLastActivity >= 35)
    .sort((a, b) => b.daysSinceLastActivity - a.daysSinceLastActivity)
    .slice(0, limit);
}
