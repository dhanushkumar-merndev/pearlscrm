"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, notFound, validationFailed } from "@/lib/errors";
import { monthsAfterSurgery, suggestFollowupLabel } from "@/lib/followup";
import {
  createFollowupSchema,
  deleteVisitSchema,
  updateVisitSchema,
} from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission } from "@/server/auth/session";
import { recordAudit, diffForAudit } from "@/server/services/audit";
import { actionResult, type ActionResult } from "@/server/actions/result";
import type { CaseVisit, MasterValue } from "@/lib/types";

/**
 * Follow-up visits.
 *
 * A follow-up is a real timeline record keyed on its actual visit date. The
 * label is presentation metadata the clinician controls; `months_after_surgery`
 * is derived from the two dates so the timeline stays truthful even when the
 * label says something else.
 */

export async function createFollowup(
  input: ActionInput<typeof createFollowupSchema>,
): Promise<ActionResult<{ visitId: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("visit:create");
    const data = createFollowupSchema.parse(input);

    const supabase = await createSupabaseServerClient();

    const { data: caseRow } = await supabase
      .from("cases")
      .select("id, surgery_date, archived_at")
      .eq("id", data.caseId)
      .maybeSingle<{ id: string; surgery_date: string; archived_at: string | null }>();

    if (!caseRow) throw notFound("This case could not be found.");
    if (caseRow.archived_at) {
      throw validationFailed("This case is archived. Restore it before adding follow-ups.");
    }

    if (data.visitDate < caseRow.surgery_date) {
      throw validationFailed("A follow-up cannot take place before the surgery date.", {
        visitDate: ["The visit date is before the surgery date."],
      });
    }

    const months = monthsAfterSurgery(caseRow.surgery_date, data.visitDate);

    const { data: visit, error } = await supabase
      .from("case_visits")
      .insert({
        case_id: data.caseId,
        visit_type: "FOLLOW_UP",
        visit_date: data.visitDate,
        display_label: data.displayLabel,
        months_after_surgery: months,
        clinical_observation: data.clinicalObservation,
        created_by: user.id,
      })
      .select("*")
      .single<CaseVisit>();

    if (error || !visit) throw new AppError("INTERNAL", "The follow-up could not be added.");

    await recordAudit({
      actorUserId: user.id,
      action: "FOLLOWUP_CREATED",
      entityType: "case_visit",
      entityId: visit.id,
      caseId: data.caseId,
      metadata: {
        visit_date: visit.visit_date,
        display_label: visit.display_label,
        months_after_surgery: months,
      },
    });

    revalidatePath(`/cases/${data.caseId}`);
    revalidatePath("/dashboard");

    return { visitId: visit.id };
  });
}

export async function updateVisit(
  input: ActionInput<typeof updateVisitSchema>,
): Promise<ActionResult<{ visitId: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("visit:update");
    const data = updateVisitSchema.parse(input);

    const supabase = await createSupabaseServerClient();

    const { data: existing } = await supabase
      .from("case_visits")
      .select("*")
      .eq("id", data.visitId)
      .maybeSingle<CaseVisit>();

    if (!existing) throw notFound("This visit could not be found.");

    const { data: caseRow } = await supabase
      .from("cases")
      .select("surgery_date")
      .eq("id", existing.case_id)
      .maybeSingle<{ surgery_date: string }>();

    const visitDate = data.visitDate ?? existing.visit_date;

    if (existing.visit_type === "FOLLOW_UP" && caseRow && visitDate && visitDate < caseRow.surgery_date) {
      throw validationFailed("A follow-up cannot take place before the surgery date.", {
        visitDate: ["The visit date is before the surgery date."],
      });
    }

    const months =
      caseRow && visitDate && existing.visit_type === "FOLLOW_UP"
        ? monthsAfterSurgery(caseRow.surgery_date, visitDate)
        : existing.months_after_surgery;

    const { data: updated, error } = await supabase
      .from("case_visits")
      .update({
        ...(data.visitDate ? { visit_date: data.visitDate } : {}),
        ...(data.displayLabel ? { display_label: data.displayLabel } : {}),
        clinical_observation: data.clinicalObservation,
        months_after_surgery: months,
      })
      .eq("id", data.visitId)
      .select("*")
      .maybeSingle<CaseVisit>();

    if (error) throw new AppError("INTERNAL", "The visit could not be updated.");
    if (!updated) throw notFound("This visit could not be updated.");

    const { changedFields, changes } = diffForAudit(
      {
        visit_date: existing.visit_date,
        display_label: existing.display_label,
        clinical_observation: existing.clinical_observation,
      },
      {
        visit_date: updated.visit_date,
        display_label: updated.display_label,
        clinical_observation: updated.clinical_observation,
      },
      // The observation is clinical narrative: record that it changed, not what it says.
      { redactFields: ["clinical_observation"] },
    );

    if (changedFields.length > 0) {
      await recordAudit({
        actorUserId: user.id,
        action: "FOLLOWUP_UPDATED",
        entityType: "case_visit",
        entityId: updated.id,
        caseId: updated.case_id,
        metadata: { changed_fields: changedFields, changes },
      });
    }

    revalidatePath(`/cases/${updated.case_id}`);

    return { visitId: updated.id };
  });
}

export async function deleteFollowup(
  input: ActionInput<typeof deleteVisitSchema>,
): Promise<ActionResult<{ deleted: true }>> {
  return actionResult(async () => {
    const user = await requirePermission("visit:delete");
    const data = deleteVisitSchema.parse(input);

    const supabase = await createSupabaseServerClient();

    const { data: visit } = await supabase
      .from("case_visits")
      .select("*")
      .eq("id", data.visitId)
      .maybeSingle<CaseVisit>();

    if (!visit) throw notFound("This visit could not be found.");
    if (visit.visit_type === "BEFORE") {
      throw validationFailed("The Before visit cannot be removed from a case.");
    }

    const { count } = await supabase
      .from("clinical_images")
      .select("id", { count: "exact", head: true })
      .eq("visit_id", data.visitId)
      .eq("availability_status", "UPLOADED");

    if ((count ?? 0) > 0) {
      throw validationFailed(
        "This follow-up has clinical images and cannot be removed. Clinical originals are never deleted.",
      );
    }

    const { error } = await supabase.from("case_visits").delete().eq("id", data.visitId);
    if (error) throw new AppError("INTERNAL", "The follow-up could not be removed.");

    await recordAudit({
      actorUserId: user.id,
      action: "FOLLOWUP_DELETED",
      entityType: "case_visit",
      entityId: data.visitId,
      caseId: visit.case_id,
      metadata: { display_label: visit.display_label, visit_date: visit.visit_date },
    });

    revalidatePath(`/cases/${visit.case_id}`);

    return { deleted: true as const };
  });
}

/**
 * Suggests a label for a candidate visit date. Read-only; the clinician is free
 * to replace whatever comes back.
 */
export async function suggestVisitLabel(
  input: { caseId: string; visitDate: string },
): Promise<ActionResult<{ label: string; monthsAfterSurgery: number }>> {
  return actionResult(async () => {
    await requirePermission("visit:create");

    const caseId = z.string().uuid().parse(input.caseId);
    const visitDate = z.string().parse(input.visitDate);

    const supabase = await createSupabaseServerClient();

    const { data: caseRow } = await supabase
      .from("cases")
      .select("surgery_date")
      .eq("id", caseId)
      .maybeSingle<{ surgery_date: string }>();

    if (!caseRow) throw notFound("This case could not be found.");

    const { data: presets } = await supabase
      .from("followup_label_presets")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .returns<MasterValue[]>();

    const label = suggestFollowupLabel(
      caseRow.surgery_date,
      visitDate,
      (presets ?? []).map((preset) => ({
        display_name: preset.display_name,
        months_after_surgery: preset.months_after_surgery ?? null,
      })),
    );

    return { label, monthsAfterSurgery: monthsAfterSurgery(caseRow.surgery_date, visitDate) };
  });
}
