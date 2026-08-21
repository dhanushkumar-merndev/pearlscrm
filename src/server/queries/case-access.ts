import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/server/auth/session";

export type CaseAccessUser = {
  id: string;
  displayName: string;
  isActive: boolean;
  role: "DOCTOR" | "VIEWER";
  visibilityScope: "ALL" | "SELECTED";
  assigned: boolean;
};

type DoctorProfileRow = {
  id: string;
  display_name: string;
  is_active: boolean;
  case_visibility_scope: "ALL" | "SELECTED";
  roles: { code: string } | null;
};

/** Doctors and Viewers available for assignment to one case. Administrator-only. */
export async function listCaseAccessUsers(caseId: string): Promise<CaseAccessUser[]> {
  await requirePermission("case_access:manage");

  const admin = createSupabaseAdminClient();
  const [profilesResult, assignmentsResult] = await Promise.all([
    admin
      .from("profiles")
      .select("id, display_name, is_active, case_visibility_scope, roles!inner(code)")
      .in("roles.code", ["DOCTOR", "VIEWER"])
      .order("display_name", { ascending: true })
      .returns<DoctorProfileRow[]>(),
    admin
      .from("case_viewer_access")
      .select("user_id")
      .eq("case_id", caseId)
      .returns<{ user_id: string }[]>(),
  ]);

  if (profilesResult.error || assignmentsResult.error) {
    throw new AppError("INTERNAL", "Could not load doctor access for this case.");
  }

  const assignedIds = new Set((assignmentsResult.data ?? []).map((row) => row.user_id));

  return (profilesResult.data ?? []).map((profile) => ({
    id: profile.id,
    displayName: profile.display_name,
    isActive: profile.is_active,
    role: profile.roles?.code as "DOCTOR" | "VIEWER",
    visibilityScope: profile.case_visibility_scope,
    assigned: assignedIds.has(profile.id),
  }));
}
