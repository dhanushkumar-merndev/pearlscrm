"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, conflict, notFound, validationFailed } from "@/lib/errors";
import { updateReviewSchema } from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission } from "@/server/auth/session";
import { recordAudit } from "@/server/services/audit";
import { actionResult, type ActionResult } from "@/server/actions/result";
import type { CaseReview } from "@/lib/types";

/**
 * Expert review: PENDING -> IN_REVIEW -> COMPLETED.
 *
 * Documented MVP behaviour for editing after completion: the review *stays*
 * COMPLETED, the edit is audited, and the previous text is snapshotted into
 * `case_review_revisions` so the assessment history is never lost.
 */

export async function updateReview(
  input: ActionInput<typeof updateReviewSchema>,
): Promise<ActionResult<{ status: string; version: number; reviewedAt: string | null }>> {
  return actionResult(async () => {
    const user = await requirePermission("review:update");
    const data = updateReviewSchema.parse(input);

    const supabase = await createSupabaseServerClient();

    const { data: existing } = await supabase
      .from("case_reviews")
      .select("*")
      .eq("case_id", data.caseId)
      .maybeSingle<CaseReview>();

    if (!existing) throw notFound("The review for this case could not be found.");

    if (data.status === "COMPLETED" && !data.finalAssessment) {
      throw validationFailed("Enter the final assessment before completing the review.", {
        finalAssessment: ["A final assessment is required to complete a review."],
      });
    }

    const wasCompleted = existing.status === "COMPLETED";
    const isCompleting = data.status === "COMPLETED";

    // `reviewed_at` is stamped when the review first completes and preserved on
    // later edits, so it always records when the assessment was signed off.
    const reviewedAt = isCompleting ? (existing.reviewed_at ?? new Date().toISOString()) : null;

    const { data: updated, error } = await supabase
      .from("case_reviews")
      .update({
        status: data.status,
        final_assessment: data.finalAssessment,
        reviewer_id: user.id,
        reviewed_at: reviewedAt,
        version: data.expectedVersion + 1,
      })
      .eq("case_id", data.caseId)
      .eq("version", data.expectedVersion)
      .select("*")
      .maybeSingle<CaseReview>();

    if (error) throw new AppError("INTERNAL", "The review could not be saved.");

    if (!updated) {
      throw conflict(
        "This review was changed by someone else while you were editing. Reload the case before saving again.",
      );
    }

    // Snapshot the *previous* text whenever a completed assessment is edited.
    if (wasCompleted && existing.final_assessment !== updated.final_assessment) {
      await supabase.from("case_review_revisions").insert({
        case_review_id: existing.id,
        case_id: data.caseId,
        status: existing.status,
        final_assessment: existing.final_assessment,
        reviewer_id: existing.reviewer_id,
      });
    }

    const action = isCompleting
      ? wasCompleted
        ? "REVIEW_UPDATED"
        : "REVIEW_COMPLETED"
      : data.status === "IN_REVIEW" && existing.status === "PENDING"
        ? "REVIEW_STARTED"
        : "REVIEW_UPDATED";

    await recordAudit({
      actorUserId: user.id,
      action,
      entityType: "case_review",
      entityId: updated.id,
      caseId: data.caseId,
      metadata: {
        from_status: existing.status,
        to_status: updated.status,
        // The assessment text itself stays out of the audit log.
        assessment_changed: existing.final_assessment !== updated.final_assessment,
        edited_after_completion: wasCompleted && isCompleting,
      },
    });

    revalidatePath(`/cases/${data.caseId}`);
    revalidatePath("/cases");
    revalidatePath("/dashboard");

    return { status: updated.status, version: updated.version, reviewedAt: updated.reviewed_at };
  });
}
