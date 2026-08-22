import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, forbidden, notFound, validationFailed } from "@/lib/errors";
import type { SessionUser } from "@/server/auth/session";
import type { CaseVisit, ImageReviewStatus } from "@/lib/types";

/**
 * Administrator review of a submitted image set.
 *
 * The decision is per photograph, so approving five views and asking for one to
 * be retaken leaves the five untouched. A retake request is what reopens that
 * one slot — there is no separate unlock to drift out of step with it.
 *
 * Authorization is checked here and again inside `review_visit_images`, which
 * refuses a non-administrator regardless of what the caller claims.
 */

export type ReviewDecision = {
  clinicalImageId: string;
  status: Extract<ImageReviewStatus, "APPROVED" | "REPHOTO_REQUESTED">;
  note?: string | null;
};

export async function reviewVisitImages(params: {
  user: SessionUser;
  caseId: string;
  visitId: string;
  decisions: ReviewDecision[];
}): Promise<CaseVisit> {
  const supabase = await createSupabaseServerClient();

  // RLS decides whether this user can see the visit at all; an unauthorized
  // caller simply gets no row rather than a different error.
  const { data: visit } = await supabase
    .from("case_visits")
    .select("id, case_id, images_locked_at")
    .eq("id", params.visitId)
    .maybeSingle<{ id: string; case_id: string; images_locked_at: string | null }>();

  if (!visit) throw notFound("This visit could not be found.");
  if (visit.case_id !== params.caseId) {
    throw forbidden("That visit does not belong to this case.");
  }
  if (!visit.images_locked_at) {
    throw validationFailed("These images have not been submitted for review yet.");
  }

  for (const decision of params.decisions) {
    if (decision.status === "REPHOTO_REQUESTED" && !decision.note?.trim()) {
      throw validationFailed(
        "Say what needs to change before asking for a photograph to be taken again.",
      );
    }
  }

  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .rpc("review_visit_images", {
      p_visit_id: params.visitId,
      p_decisions: params.decisions.map((decision) => ({
        clinical_image_id: decision.clinicalImageId,
        status: decision.status,
        note: decision.note?.trim() || null,
      })),
      p_actor: params.user.id,
    })
    .single<CaseVisit>();

  if (error || !data) {
    if (error?.code === "42501") throw forbidden("Only an administrator can review images.");
    if (error?.code === "P0002") throw notFound("This visit could not be found.");
    throw new AppError("INTERNAL", "The review could not be saved.");
  }

  return data;
}
