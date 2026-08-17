"use server";

import { revalidatePath } from "next/cache";

import {
  clearImageUnavailableSchema,
  markImageUnavailableSchema,
} from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission } from "@/server/auth/session";
import { clearImageUnavailable, markImageUnavailable } from "@/server/services/images";
import { actionResult, type ActionResult } from "@/server/actions/result";

/**
 * Image availability.
 *
 * A genuinely unavailable view is recorded as NOT_AVAILABLE with a reason and
 * an audit trail, rather than being left MISSING or — worse — filled with the
 * wrong photograph to satisfy a checklist.
 */

export async function markSlotUnavailable(
  input: ActionInput<typeof markImageUnavailableSchema>,
): Promise<ActionResult<{ imageId: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("image:mark_unavailable");
    const data = markImageUnavailableSchema.parse(input);

    const image = await markImageUnavailable({
      user,
      caseId: data.caseId,
      visitId: data.visitId,
      viewTypeId: data.viewTypeId,
      reason: data.reason,
    });

    revalidatePath(`/cases/${data.caseId}`);

    return { imageId: image.id };
  });
}

export async function clearSlotUnavailable(
  input: ActionInput<typeof clearImageUnavailableSchema>,
): Promise<ActionResult<{ cleared: true }>> {
  return actionResult(async () => {
    const user = await requirePermission("image:mark_unavailable");
    const data = clearImageUnavailableSchema.parse(input);

    await clearImageUnavailable({
      user,
      visitId: data.visitId,
      viewTypeId: data.viewTypeId,
    });

    revalidatePath("/cases");

    return { cleared: true as const };
  });
}
