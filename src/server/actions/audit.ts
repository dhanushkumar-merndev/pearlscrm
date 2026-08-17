"use server";

import { z } from "zod";

import { requirePermission } from "@/server/auth/session";
import { getCaseAuditHistory, type AuditLogRow } from "@/server/queries/audit";
import { actionResult, type ActionResult } from "@/server/actions/result";

export async function getCaseAudit(input: {
  caseId: string;
}): Promise<ActionResult<AuditLogRow[]>> {
  return actionResult(async () => {
    await requirePermission("audit:read");
    const caseId = z.string().uuid().parse(input.caseId);

    return getCaseAuditHistory(caseId);
  });
}
