import { jsonOk, withApiErrors } from "@/lib/api/route";
import { requireUser } from "@/server/auth/session";
import {
  getDashboardMetrics,
  getFollowupAttention,
  getRecentCases,
} from "@/server/queries/dashboard";

/** Current authorized dashboard snapshot, intentionally private/no-store. */
export const GET = withApiErrors(async () => {
  await requireUser();

  const [metrics, recentCases, followupAttention] = await Promise.all([
    getDashboardMetrics(),
    getRecentCases(),
    getFollowupAttention(),
  ]);

  return jsonOk({ metrics, recentCases, followupAttention });
});
