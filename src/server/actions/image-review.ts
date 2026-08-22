"use server";

import { revalidatePath } from "next/cache";

import { reviewVisitImagesSchema } from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission } from "@/server/auth/session";
import { reviewVisitImages } from "@/server/services/image-review";
import { actionResult, type ActionResult } from "@/server/actions/result";

/**
 * Records the administrator's decision on each photograph in a phase.
 *
 * Sent once for the whole phase rather than per card: the review is a single
 * judgement, it should be one audit event and one notification, and a
 * half-recorded review is not a state worth being able to reach.
 */
export async function reviewVisitImagesAction(
  input: ActionInput<typeof reviewVisitImagesSchema>,
): Promise<ActionResult<{ visitId: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("image:review");
    const data = reviewVisitImagesSchema.parse(input);

    const visit = await reviewVisitImages({
      user,
      caseId: data.caseId,
      visitId: data.visitId,
      decisions: data.decisions.map((decision) => ({
        clinicalImageId: decision.clinicalImageId,
        status: decision.status,
        note: decision.note ?? null,
      })),
    });

    revalidatePath(`/cases/${data.caseId}`);

    return { visitId: visit.id };
  });
}
