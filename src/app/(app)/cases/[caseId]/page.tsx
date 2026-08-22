import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CaseDetailHeader } from "@/components/cases/case-detail-header";
import { CaseTabs } from "@/components/cases/case-tabs";
import { requireUser } from "@/server/auth/session";
import { getCaseDetail, listStandardViewTypes } from "@/server/queries/cases";
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

  try {
    const detail = await getCaseDetail(caseId);
    // The page title carries the case ID only — never anything identifying.
    return { title: detail.summary.case_number };
  } catch {
    return { title: "Case" };
  }
}

const CASE_TAB_VALUES = new Set([
  "overview",
  "before",
  "after",
  "followups",
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

  const [viewTypes, accessUsers, notesEditAccess, reviewComments] = await Promise.all([
    listStandardViewTypes(),
    can(user.role, "case_access:manage")
      ? listCaseAccessUsers(caseId)
      : Promise.resolve(null),
    resolveEditAccess(user, { scope: "CASE_NOTES", caseId }),
    getReviewComments(caseId),
  ]);

  return (
    <>
      <CaseDetailHeader detail={detail} role={user.role} accessUsers={accessUsers} />
      <CaseTabs
        detail={detail}
        viewTypes={viewTypes}
        role={user.role}
        currentUserId={user.id}
        notesEditAccess={notesEditAccess}
        reviewComments={reviewComments}
        initialTab={initialTab}
        // Read server-side so the client validates against the real configured
        // limit rather than a duplicated constant.
        maxImageBytes={serverEnv().MAX_IMAGE_BYTES}
      />
    </>
  );
}
