"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, conflict, notFound } from "@/lib/errors";
import { updateCaseNotesSchema } from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission } from "@/server/auth/session";
import { recordAudit, diffForAudit } from "@/server/services/audit";
import { actionResult, type ActionResult } from "@/server/actions/result";
import type { CaseNotes } from "@/lib/types";

/**
 * Structured case notes.
 *
 * Notes are stored as discrete clinical fields, never as one narrative blob,
 * and are written explicitly — there is no keystroke autosave. Optimistic
 * concurrency on `version` means two clinicians editing the same case cannot
 * silently overwrite each other.
 */

/** Long-form clinical narrative: audited as "changed", never copied verbatim. */
const NARRATIVE_FIELDS = [
  "patient_concern",
  "preop_assessment",
  "treatment_recommendation",
  "preop_aesthetic_goal",
  "dorsum",
  "tip",
  "projection",
  "rotation",
  "alar",
  "septum",
  "other_anatomical_change",
  "surgeon_assessment",
  "outcome",
  "patient_satisfaction",
  "complication_details",
];

export async function updateCaseNotes(
  input: ActionInput<typeof updateCaseNotesSchema>,
): Promise<ActionResult<{ version: number; savedAt: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("notes:update");
    const data = updateCaseNotesSchema.parse(input);

    const supabase = await createSupabaseServerClient();

    const { data: existing } = await supabase
      .from("case_notes")
      .select("*")
      .eq("case_id", data.caseId)
      .maybeSingle<CaseNotes>();

    if (!existing) throw notFound("Case notes for this case could not be found.");

    const next = {
      patient_concern: data.patientConcern,
      preop_assessment: data.preopAssessment,
      treatment_recommendation: data.treatmentRecommendation,
      preop_aesthetic_goal: data.preopAestheticGoal,
      dorsum: data.dorsum,
      tip: data.tip,
      projection: data.projection,
      rotation: data.rotation,
      alar: data.alar,
      septum: data.septum,
      other_anatomical_change: data.otherAnatomicalChange,
      surgeon_assessment: data.surgeonAssessment,
      outcome: data.outcome,
      patient_satisfaction: data.patientSatisfaction,
      complications_present: data.complicationsPresent,
      complication_type_id: data.complicationTypeId ?? null,
      complication_details: data.complicationDetails,
      revision_required: data.revisionRequired,
    };

    const { data: updated, error } = await supabase
      .from("case_notes")
      .update({ ...next, version: data.expectedVersion + 1, updated_by: user.id })
      .eq("case_id", data.caseId)
      .eq("version", data.expectedVersion)
      .select("*")
      .maybeSingle<CaseNotes>();

    if (error) throw new AppError("INTERNAL", "The case notes could not be saved.");

    if (!updated) {
      throw conflict(
        "These notes were changed by someone else while you were editing. Reload the case to see the latest version before saving again.",
      );
    }

    await syncChangesPerformed(data.caseId, data.changesPerformed, user.id);

    const { changedFields, changes } = diffForAudit(
      Object.fromEntries(Object.keys(next).map((key) => [key, existing[key as keyof CaseNotes]])),
      next,
      { redactFields: NARRATIVE_FIELDS },
    );

    await recordAudit({
      actorUserId: user.id,
      action: "CASE_NOTES_UPDATED",
      entityType: "case_notes",
      entityId: updated.id,
      caseId: data.caseId,
      metadata: {
        changed_fields: changedFields,
        changes,
        changes_performed_count: data.changesPerformed.length,
        version: updated.version,
      },
    });

    revalidatePath(`/cases/${data.caseId}`);

    return { version: updated.version, savedAt: updated.updated_at };
  });
}

/**
 * Replaces the ordered "changes performed" list.
 *
 * Order is stored explicitly as `sort_order` so reordering in the UI survives a
 * reload, rather than depending on insertion order.
 */
async function syncChangesPerformed(
  caseId: string,
  changes: { id?: string; description: string }[],
  actorId: string,
) {
  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from("case_changes_performed")
    .select("id")
    .eq("case_id", caseId)
    .returns<{ id: string }[]>();

  const existingIds = new Set((existing ?? []).map((row) => row.id));
  const keptIds = new Set(changes.map((change) => change.id).filter(Boolean) as string[]);

  const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
  if (toDelete.length > 0) {
    await supabase.from("case_changes_performed").delete().in("id", toDelete);
  }

  for (const [index, change] of changes.entries()) {
    if (change.id && existingIds.has(change.id)) {
      await supabase
        .from("case_changes_performed")
        .update({ description: change.description, sort_order: index })
        .eq("id", change.id);
    } else {
      await supabase.from("case_changes_performed").insert({
        case_id: caseId,
        description: change.description,
        sort_order: index,
        created_by: actorId,
      });
    }
  }
}
