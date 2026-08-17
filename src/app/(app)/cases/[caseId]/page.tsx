import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CaseDetailHeader } from "@/components/cases/case-detail-header";
import { CaseTabs } from "@/components/cases/case-tabs";
import { requireUser } from "@/server/auth/session";
import { getCaseDetail, listStandardViewTypes } from "@/server/queries/cases";
import { AppError } from "@/lib/errors";
import { serverEnv } from "@/lib/env/server";

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
    detail = await getCaseDetail(caseId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const viewTypes = await listStandardViewTypes();

  return (
    <>
      <CaseDetailHeader detail={detail} role={user.role} />
      <CaseTabs
        detail={detail}
        viewTypes={viewTypes}
        role={user.role}
        // Read server-side so the client validates against the real configured
        // limit rather than a duplicated constant.
        maxImageBytes={serverEnv().MAX_IMAGE_BYTES}
      />
    </>
  );
}
