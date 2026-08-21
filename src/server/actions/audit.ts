"use server";

import { z } from "zod";

import { requirePermission } from "@/server/auth/session";
import { getCaseAuditHistory, type CaseAuditPage } from "@/server/queries/audit";
import { actionResult, type ActionResult } from "@/server/actions/result";

const caseAuditSchema = z.object({
  caseId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

/**
 * One page of a case's audit history. Paginated in the database — the browser
 * never receives the whole trail, which grows for the life of the case.
 */
export async function getCaseAudit(
  input: z.input<typeof caseAuditSchema>,
): Promise<ActionResult<CaseAuditPage>> {
  return actionResult(async () => {
    await requirePermission("audit:read");
    const data = caseAuditSchema.parse(input);

    return getCaseAuditHistory(data.caseId, data.page, data.pageSize);
  });
}
