"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors";
import { recordConsentSchema } from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission } from "@/server/auth/session";
import { recordAudit } from "@/server/services/audit";
import { actionResult, type ActionResult } from "@/server/actions/result";
import type { CaseConsent } from "@/lib/types";

/**
 * Consent for image use.
 *
 * Consent is append-only: recording a new answer never overwrites the previous
 * one, so the full history stays auditable. Three states are represented —
 * YES, NO, and "not yet recorded" — and a missing record is never silently
 * treated as NO.
 *
 * Consent for image use is not authorization to publish: this application has
 * no public gallery, and consent alone never makes a case visible externally.
 */

export async function recordConsent(
  input: ActionInput<typeof recordConsentSchema>,
): Promise<ActionResult<{ consentId: string; imageUseConsent: boolean }>> {
  return actionResult(async () => {
    const user = await requirePermission("consent:record");
    const data = recordConsentSchema.parse(input);

    const supabase = await createSupabaseServerClient();

    const { data: previous } = await supabase
      .from("case_consents")
      .select("*")
      .eq("case_id", data.caseId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle<CaseConsent>();

    const { data: consent, error } = await supabase
      .from("case_consents")
      .insert({
        case_id: data.caseId,
        image_use_consent: data.imageUseConsent,
        notes: data.notes,
        recorded_by: user.id,
      })
      .select("*")
      .single<CaseConsent>();

    if (error || !consent) throw new AppError("INTERNAL", "Consent could not be recorded.");

    await recordAudit({
      actorUserId: user.id,
      action: previous ? "CONSENT_CHANGED" : "CONSENT_RECORDED",
      entityType: "case_consent",
      entityId: consent.id,
      caseId: data.caseId,
      metadata: {
        image_use_consent: consent.image_use_consent,
        ...(previous ? { previous_image_use_consent: previous.image_use_consent } : {}),
        has_notes: Boolean(consent.notes),
        // A consent change is one of the most consequential edits on a case, so
        // it is recorded in the shared `{ field: { from, to } }` shape and shows
        // on the Changes screen with the rest.
        ...(previous && previous.image_use_consent !== consent.image_use_consent
          ? {
              changed_fields: ["image_use_consent"],
              changes: {
                image_use_consent: {
                  from: previous.image_use_consent,
                  to: consent.image_use_consent,
                },
              },
            }
          : {}),
      },
    });

    revalidatePath(`/cases/${data.caseId}`);
    revalidatePath("/cases");

    return { consentId: consent.id, imageUseConsent: consent.image_use_consent };
  });
}
