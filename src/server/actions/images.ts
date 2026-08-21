"use server";

import { revalidatePath } from "next/cache";

import {
  clearImageUnavailableSchema,
  markImageUnavailableSchema,
  removeImageSchema,
} from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission } from "@/server/auth/session";
import {
  clearImageUnavailable,
  markImageUnavailable,
  removeCurrentImage,
} from "@/server/services/images";
import { actionResult, type ActionResult } from "@/server/actions/result";

/**
 * Image availability and slot clearing.
 *
 * A genuinely unavailable view is recorded as NOT_AVAILABLE with a reason and
 * an audit trail, rather than being left MISSING or — worse — filled with the
 * wrong photograph to satisfy a checklist. Removing an image empties the slot
 * without destroying the stored original.
 *
 * Each of these writes into the VISIT_IMAGES scope, so the service layer checks
 * the submission lock and any approval grant before the write lands.
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

export async function removeSlotImage(
  input: ActionInput<typeof removeImageSchema>,
): Promise<ActionResult<{ imageId: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("image:remove");
    const data = removeImageSchema.parse(input);

    const image = await removeCurrentImage({
      user,
      caseId: data.caseId,
      visitId: data.visitId,
      viewTypeId: data.viewTypeId,
    });

    revalidatePath(`/cases/${data.caseId}`);

    return { imageId: image.id };
  });
}
