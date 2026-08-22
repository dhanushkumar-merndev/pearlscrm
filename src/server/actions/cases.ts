"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, conflict, notFound } from "@/lib/errors";
import {
  archiveCaseSchema,
  createCaseSchema,
  restoreCaseSchema,
  updateCaseSchema,
} from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission } from "@/server/auth/session";
import { enforceWriteRateLimit } from "@/lib/rate-limit";
import { recordAudit, diffForAudit } from "@/server/services/audit";
import { consumeEditGrant, requireEditAccess } from "@/server/services/edit-access";
import { actionResult, type ActionResult } from "@/server/actions/result";
import type { CaseRow } from "@/lib/types";

/**
 * Case lifecycle operations.
 *
 * Each one authenticates, authorizes, validates, performs its writes inside a
 * transaction where atomicity matters, audits, and returns a safe result.
 */

export async function createCase(
  input: ActionInput<typeof createCaseSchema>,
): Promise<ActionResult<{ caseId: string; caseNumber: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("case:create");
    const data = createCaseSchema.parse(input);
    await enforceWriteRateLimit("caseCreate", user.id);

    const admin = createSupabaseAdminClient();

    // Case number allocation, case insert, BEFORE visit and audit all happen
    // inside `public.create_case` so a partial case can never exist.
    const { data: created, error } = await admin
      .rpc("create_case", {
        p_procedure_id: data.procedureId,
        p_procedure_type_id: data.procedureTypeId,
        p_surgery_date: data.surgeryDate,
        p_followup_availability: data.followupAvailability,
        p_tag_ids: data.tagIds,
        p_actor: user.id,
      })
      .single<CaseRow>();

    if (error || !created) {
      if (error?.code === "23503") {
        throw notFound("The selected procedure or procedure type no longer exists.");
      }
      throw new AppError("INTERNAL", "The case could not be created.");
    }

    if (data.consent !== "NOT_RECORDED") {
      await admin.from("case_consents").insert({
        case_id: created.id,
        image_use_consent: data.consent === "YES",
        notes: data.consentNotes,
        recorded_by: user.id,
      });

      await recordAudit({
        actorUserId: user.id,
        action: "CONSENT_RECORDED",
        entityType: "case_consent",
        entityId: created.id,
        caseId: created.id,
        metadata: { image_use_consent: data.consent === "YES" },
      });
    }

    revalidatePath("/cases");
    revalidatePath("/dashboard");

    return { caseId: created.id, caseNumber: created.case_number };
  });
}

export async function updateCase(
  input: ActionInput<typeof updateCaseSchema>,
): Promise<ActionResult<{ version: number }>> {
  return actionResult(async () => {
    const user = await requirePermission("case:update");
    const data = updateCaseSchema.parse(input);

    const supabase = await createSupabaseServerClient();

    const { data: existing } = await supabase
      .from("cases")
      .select("*")
      .eq("id", data.caseId)
      .maybeSingle<CaseRow>();

    if (!existing) throw notFound("This case could not be found.");

    // Case information locks when the case is created. Editing it again needs
    // an administrator's approval, checked here and not only in the UI.
    const grantId = await requireEditAccess(user, {
      scope: "CASE_INFORMATION",
      caseId: data.caseId,
    });

    const nextVersion = data.expectedVersion + 1;

    // Optimistic concurrency: the update only matches while the row still holds
    // the version the editor loaded.
    const { data: updated, error } = await supabase
      .from("cases")
      .update({
        procedure_id: data.procedureId,
        procedure_type_id: data.procedureTypeId,
        surgery_date: data.surgeryDate,
        followup_availability: data.followupAvailability,
        version: nextVersion,
      })
      .eq("id", data.caseId)
      .eq("version", data.expectedVersion)
      .select("*")
      .maybeSingle<CaseRow>();

    if (error) throw new AppError("INTERNAL", "The case could not be updated.");

    if (!updated) {
      throw conflict(
        "This case was changed by someone else while you were editing. Reload to see the latest version.",
      );
    }

    await syncCaseTags(data.caseId, data.tagIds, user.id);

    const { changedFields, changes } = diffForAudit(
      {
        procedure_id: existing.procedure_id,
        procedure_type_id: existing.procedure_type_id,
        surgery_date: existing.surgery_date,
        followup_availability: existing.followup_availability,
      },
      {
        procedure_id: updated.procedure_id,
        procedure_type_id: updated.procedure_type_id,
        surgery_date: updated.surgery_date,
        followup_availability: updated.followup_availability,
      },
    );

    if (changedFields.length > 0) {
      await recordAudit({
        actorUserId: user.id,
        action: "CASE_UPDATED",
        entityType: "case",
        entityId: data.caseId,
        caseId: data.caseId,
        metadata: { changed_fields: changedFields, changes },
      });
    }

    // The approval was single use: spend it now that the save has landed.
    await consumeEditGrant(grantId, user.id);

    revalidatePath(`/cases/${data.caseId}`);
    revalidatePath("/cases");

    return { version: updated.version };
  });
}

async function syncCaseTags(caseId: string, tagIds: string[], actorId: string) {
  const supabase = await createSupabaseServerClient();

  const { data: current } = await supabase
    .from("case_tags")
    .select("tag_id")
    .eq("case_id", caseId)
    .returns<{ tag_id: string }[]>();

  const currentIds = new Set((current ?? []).map((row) => row.tag_id));
  const nextIds = new Set(tagIds);

  const toAdd = [...nextIds].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !nextIds.has(id));

  if (toAdd.length > 0) {
    await supabase
      .from("case_tags")
      .insert(toAdd.map((tagId) => ({ case_id: caseId, tag_id: tagId, created_by: actorId })));
  }

  if (toRemove.length > 0) {
    await supabase.from("case_tags").delete().eq("case_id", caseId).in("tag_id", toRemove);
  }
}

export async function archiveCase(
  input: ActionInput<typeof archiveCaseSchema>,
): Promise<ActionResult<{ archived: true }>> {
  return actionResult(async () => {
    const user = await requirePermission("case:archive");
    const data = archiveCaseSchema.parse(input);

    const supabase = await createSupabaseServerClient();

    const { data: updated, error } = await supabase
      .from("cases")
      .update({
        status: "ARCHIVED",
        archived_at: new Date().toISOString(),
        archived_by: user.id,
      })
      .eq("id", data.caseId)
      .is("archived_at", null)
      .select("id, case_number")
      .maybeSingle<{ id: string; case_number: string }>();

    if (error) throw new AppError("INTERNAL", "The case could not be archived.");
    if (!updated) throw notFound("This case could not be found, or it is already archived.");

    await recordAudit({
      actorUserId: user.id,
      action: "CASE_ARCHIVED",
      entityType: "case",
      entityId: data.caseId,
      caseId: data.caseId,
      metadata: { case_number: updated.case_number, reason: data.reason ?? null },
    });

    revalidatePath("/cases");
    revalidatePath(`/cases/${data.caseId}`);

    return { archived: true as const };
  });
}

export async function restoreCase(
  input: ActionInput<typeof restoreCaseSchema>,
): Promise<ActionResult<{ restored: true }>> {
  return actionResult(async () => {
    const user = await requirePermission("case:restore");
    const data = restoreCaseSchema.parse(input);

    const supabase = await createSupabaseServerClient();

    const { data: updated, error } = await supabase
      .from("cases")
      .update({ status: "ACTIVE", archived_at: null, archived_by: null })
      .eq("id", data.caseId)
      .not("archived_at", "is", null)
      .select("id, case_number")
      .maybeSingle<{ id: string; case_number: string }>();

    if (error) throw new AppError("INTERNAL", "The case could not be restored.");
    if (!updated) throw notFound("This case could not be found, or it is not archived.");

    await recordAudit({
      actorUserId: user.id,
      action: "CASE_RESTORED",
      entityType: "case",
      entityId: data.caseId,
      caseId: data.caseId,
      metadata: { case_number: updated.case_number },
    });

    revalidatePath("/cases");
    revalidatePath(`/cases/${data.caseId}`);

    return { restored: true as const };
  });
}

/**
 * Marks a case COMPLETED. Requires every completion rule to hold — crossing a
 * percentage is explicitly not sufficient.
 */
export async function markCaseCompleted(
  input: { caseId: string },
): Promise<ActionResult<{ status: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("case:update");
    const caseId = z.string().uuid().parse(input.caseId);

    const supabase = await createSupabaseServerClient();

    const { data: facts } = await supabase.rpc("case_completion", { p_case_id: caseId });

    const completion = facts as Record<string, boolean> | null;
    if (!completion) throw notFound("This case could not be found.");

    const required = [
      "case_information",
      "before_images",
      "case_notes",
      "consent",
      "expert_review",
    ] as const;

    const outstanding = required.filter((key) => !completion[key]);

    if (outstanding.length > 0) {
      throw new AppError(
        "VALIDATION",
        "This case cannot be completed yet. Some required items are still outstanding.",
        { completion: outstanding.map((key) => key.replaceAll("_", " ")) },
      );
    }

    const { error } = await supabase
      .from("cases")
      .update({ status: "COMPLETED" })
      .eq("id", caseId)
      .is("archived_at", null);

    if (error) throw new AppError("INTERNAL", "The case could not be completed.");

    await recordAudit({
      actorUserId: user.id,
      action: "CASE_UPDATED",
      entityType: "case",
      entityId: caseId,
      caseId,
      metadata: { changed_fields: ["status"], changes: { status: { from: "ACTIVE", to: "COMPLETED" } } },
    });

    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/cases");

    return { status: "COMPLETED" };
  });
}

export async function reopenCase(input: { caseId: string }): Promise<ActionResult<{ status: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("case:update");
    const caseId = z.string().uuid().parse(input.caseId);

    const supabase = await createSupabaseServerClient();

    const { error } = await supabase
      .from("cases")
      .update({ status: "ACTIVE" })
      .eq("id", caseId)
      .eq("status", "COMPLETED");

    if (error) throw new AppError("INTERNAL", "The case could not be reopened.");

    await recordAudit({
      actorUserId: user.id,
      action: "CASE_UPDATED",
      entityType: "case",
      entityId: caseId,
      caseId,
      metadata: { changed_fields: ["status"], changes: { status: { from: "COMPLETED", to: "ACTIVE" } } },
    });

    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/cases");

    return { status: "ACTIVE" };
  });
}
