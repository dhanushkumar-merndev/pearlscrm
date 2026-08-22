"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { addReviewCommentSchema } from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission } from "@/server/auth/session";
import { actionResult, type ActionResult } from "@/server/actions/result";
import { getReviewComments } from "@/server/queries/review-comments";
import type { CaseReviewCommentWithAuthor } from "@/lib/types";

/**
 * Discussion on the expert review.
 *
 * The final assessment stays the administrator's to write. This is how the
 * operating surgeon says they read it differently, on the record and attached
 * to the case, rather than in a channel the case knows nothing about.
 */
export async function addReviewComment(
  input: ActionInput<typeof addReviewCommentSchema>,
): Promise<ActionResult<{ comments: CaseReviewCommentWithAuthor[] }>> {
  return actionResult(async () => {
    const user = await requirePermission("review:comment");
    const data = addReviewCommentSchema.parse(input);

    const admin = createSupabaseAdminClient();

    const { error } = await admin.rpc("add_review_comment", {
      p_case_id: data.caseId,
      p_body: data.body,
      p_actor: user.id,
    });

    if (error) {
      if (error.code === "42501") throw forbidden("This account cannot comment on a review.");
      if (error.code === "P0002") throw notFound("This case could not be found.");
      if (error.code === "22023") {
        throw new AppError("VALIDATION", "This case is archived.");
      }
      throw new AppError("INTERNAL", "Your comment could not be saved.");
    }

    revalidatePath(`/cases/${data.caseId}`);

    // Returned rather than re-fetched by the client, so the thread the author
    // sees after sending is the thread the server just wrote.
    return { comments: await getReviewComments(data.caseId) };
  });
}
