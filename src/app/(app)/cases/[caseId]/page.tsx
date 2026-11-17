import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CaseDetailHeader } from "@/components/cases/case-detail-header";
import { CaseTabs } from "@/components/cases/case-tabs";
import { requireUser } from "@/server/auth/session";
import { getCaseDetail, listSessionViewTypes, listStandardViewTypes } from "@/server/queries/cases";
import { listDoctors } from "@/server/queries/patients";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SurgeryReminder } from "@/lib/types";
import { listCaseAccessUsers } from "@/server/queries/case-access";
import { getReviewComments } from "@/server/queries/review-comments";
import { AppError } from "@/lib/errors";
import { serverEnv } from "@/lib/env/server";
import { can } from "@/lib/permissions";
import { resolveEditAccess } from "@/server/services/edit-access";

export async function generateMetadata({
  params,
}: PageProps<"/cases/[caseId]">): Promise<Metadata> {
  const { caseId } = await params;

  // One small RLS-checked query; loading the whole case here as well doubled
  // the database work on every visit. The title is the case ID only.
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("case_list_view")
      .select("case_number")
      .eq("id", caseId)
      .maybeSingle<{ case_number: string }>();
    return { title: data?.case_number ?? "Case" };
  } catch {
    return { title: "Case" };
  }
}

const CASE_TAB_VALUES = new Set([
  "overview",
  "before",
  "after",
  "followups",
  "sessions",
  "notes",
  "consent",
  "review",
  "audit",
]);

export default async function CaseDetailPage({
  params,
  searchParams,
}: PageProps<"/cases/[caseId]">) {
  const user = await requireUser();
  const { caseId } = await params;
  const query = await searchParams;
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const initialTab = requestedTab && CASE_TAB_VALUES.has(requestedTab) ? requestedTab : "overview";

  let detail;
  try {
    detail = await getCaseDetail(caseId, { includeCreator: user.role === "ADMIN" });
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const supabase = await createSupabaseServerClient();

  const [viewTypes, accessUsers, notesEditAccess, reviewComments, sessionViewTypes, doctors, reminders] = await Promise.all([
    listStandardViewTypes(),
    can(user.role, "case_access:manage")
      ? listCaseAccessUsers(caseId)
      : Promise.resolve(null),
    resolveEditAccess(user, { scope: "CASE_NOTES", caseId }),
    getReviewComments(caseId),
    listSessionViewTypes(),
    user.role === "VIEWER" ? Promise.resolve([]) : listDoctors(),
    supabase
      .from("surgery_reminders")
      .select("*")
      .eq("case_id", caseId)
      .eq("status", "PENDING")
      .order("remind_at", { ascending: true })
      .returns<SurgeryReminder[]>()
      .then((res) => res.data ?? []),
  ]);

  return (
    <>
      <CaseDetailHeader
        detail={detail}
        role={user.role}
        accessUsers={accessUsers}
        doctors={doctors}
        reminders={reminders}
      />
      <CaseTabs
        detail={detail}
        viewTypes={viewTypes}
        role={user.role}
        currentUserId={user.id}
        notesEditAccess={notesEditAccess}
        reviewComments={reviewComments}
        sessionViewTypes={sessionViewTypes}
        doctors={doctors}
        initialTab={initialTab}
        // Read server-side so the client validates against the real configured
        // limit rather than a duplicated constant.
        maxImageBytes={serverEnv().MAX_IMAGE_BYTES}
      />
    </>
  );
}
