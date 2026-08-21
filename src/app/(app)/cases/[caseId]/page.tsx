import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RealtimeRefresh } from "@/components/app/realtime-refresh";
import { CaseDetailHeader } from "@/components/cases/case-detail-header";
import { CaseTabs } from "@/components/cases/case-tabs";
import { requireUser } from "@/server/auth/session";
import { getCaseDetail, listStandardViewTypes } from "@/server/queries/cases";
import { listCaseAccessUsers } from "@/server/queries/case-access";
import { AppError } from "@/lib/errors";
import { serverEnv } from "@/lib/env/server";
import { can } from "@/lib/permissions";
import { resolveEditAccess } from "@/server/services/edit-access";

export async function generateMetadata({
  params,
}: PageProps<"/cases/[caseId]">): Promise<Metadata> {
  const { caseId } = await params;

  try {
    const detail = await getCaseDetail(caseId);
    // The page title carries the case ID only — never anything identifying.
    return { title: detail.summary.case_number };
  } catch {
    return { title: "Case" };
  }
}

export default async function CaseDetailPage({ params }: PageProps<"/cases/[caseId]">) {
  const user = await requireUser();
  const { caseId } = await params;

  let detail;
  try {
    detail = await getCaseDetail(caseId, { includeCreator: user.role === "ADMIN" });
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [viewTypes, accessUsers, notesEditAccess] = await Promise.all([
    listStandardViewTypes(),
    can(user.role, "case_access:manage")
      ? listCaseAccessUsers(caseId)
      : Promise.resolve(null),
    resolveEditAccess(user, { scope: "CASE_NOTES", caseId }),
  ]);

  return (
    <>
      <RealtimeRefresh
        channel={`case:${caseId}`}
        tables={[
          { table: "cases", filter: `id=eq.${caseId}` },
          { table: "case_visits", filter: `case_id=eq.${caseId}` },
          { table: "clinical_images", filter: `case_id=eq.${caseId}` },
          { table: "case_edit_requests", filter: `case_id=eq.${caseId}` },
          { table: "case_reviews", filter: `case_id=eq.${caseId}` },
        ]}
      />

      <CaseDetailHeader detail={detail} role={user.role} accessUsers={accessUsers} />
      <CaseTabs
        detail={detail}
        viewTypes={viewTypes}
        role={user.role}
        currentUserId={user.id}
        notesEditAccess={notesEditAccess}
        // Read server-side so the client validates against the real configured
        // limit rather than a duplicated constant.
        maxImageBytes={serverEnv().MAX_IMAGE_BYTES}
      />
    </>
  );
}
