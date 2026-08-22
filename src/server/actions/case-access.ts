"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AppError, notFound } from "@/lib/errors";
import { updateCaseAccessSchema } from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission } from "@/server/auth/session";
import { enforceWriteRateLimit } from "@/lib/rate-limit";
import { actionResult, type ActionResult } from "@/server/actions/result";

export async function updateCaseAccess(
  input: ActionInput<typeof updateCaseAccessSchema>,
): Promise<ActionResult<{ assignedCount: number }>> {
  return actionResult(async () => {
    const actor = await requirePermission("case_access:manage");
    const data = updateCaseAccessSchema.parse(input);
    await enforceWriteRateLimit("userAccessChange", actor.id);
    const admin = createSupabaseAdminClient();

    const { error } = await admin.rpc("set_case_access", {
      p_case_id: data.caseId,
      p_user_ids: [...new Set(data.userIds)],
      p_actor: actor.id,
    });

    if (error?.code === "P0002") throw notFound("This case could not be found.");
    if (error) throw new AppError("INTERNAL", "Case access could not be updated.");

    revalidatePath(`/cases/${data.caseId}`);
    revalidatePath("/cases");
    revalidatePath("/dashboard");

    return { assignedCount: new Set(data.userIds).size };
  });
}
