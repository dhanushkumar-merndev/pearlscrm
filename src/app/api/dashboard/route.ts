import { jsonOk, withApiErrors } from "@/lib/api/route";
import { requireUser } from "@/server/auth/session";
import {
  getDashboardMetrics,
  getFollowupAttention,
  getRecentCases,
  getUpcomingSurgeries,
  getVisitsDue,
} from "@/server/queries/dashboard";
import { can } from "@/lib/permissions";

/** Current authorized dashboard snapshot, intentionally private/no-store. */
export const GET = withApiErrors(async () => {
  const user = await requireUser();

  const [metrics, recentCases, followupAttention, upcomingSurgeries, visitsDue] = await Promise.all([
    getDashboardMetrics(),
    getRecentCases(),
    getFollowupAttention(),
    getUpcomingSurgeries(),
    can(user.role, "patient:read") ? getVisitsDue() : Promise.resolve([]),
  ]);

  return jsonOk({ metrics, recentCases, followupAttention, upcomingSurgeries, visitsDue });
});
