"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceWriteRateLimit } from "@/lib/rate-limit";
import type { ActionInput } from "@/lib/validation/action-input";
import {
  addSessionSchema,
  cancelSurgerySchema,
  completeSessionSchema,
  createTreatmentSchema,
  markForSurgerySchema,
} from "@/lib/validation/schemas";
import type { CaseRow, CaseVisit } from "@/lib/types";
import { requirePermission } from "@/server/auth/session";
import { actionResult, type ActionResult } from "@/server/actions/result";
import { requireCaseWriteAccess } from "@/server/services/case-write-access";
import { rpcError } from "@/server/services/rpc-errors";

/**
 * Treatments (a patient's cases), their sessions, and surgery scheduling.
 * The RPCs re-check that the actor may write the treatment; the session check
 * here gives the clearer message first.
 */

function revalidateTreatment(caseId: string, patientId?: string | null) {
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  revalidatePath("/dashboard");
  if (patientId) revalidatePath(`/patients/${patientId}`);
}

export async function createTreatment(
  input: ActionInput<typeof createTreatmentSchema>,
): Promise<ActionResult<{ id: string; caseNumber: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("treatment:create");
    const data = createTreatmentSchema.parse(input);
    await enforceWriteRateLimit("caseCreate", user.id);

    const admin = createSupabaseAdminClient();
    const { data: row, error } = await admin
      .rpc("create_treatment", {
        p_patient_id: data.patientId,
        p_branch_id: data.branchId,
        p_procedure_id: data.procedureId,
        p_procedure_type_id: data.procedureTypeId,
        p_mode: data.mode,
        p_planned_sessions: data.plannedSessions,
        p_start_date: data.startDate,
        p_surgery_date: data.mode === "SURGICAL" ? data.surgeryDate : null,
        p_consultation_id: data.consultationId,
        p_followup_availability: data.followupAvailability,
        p_tag_ids: data.tagIds,
        p_actor: user.id,
      })
      .single<CaseRow>();

    if (error || !row) throw rpcError(error, "The treatment could not be created.");

    revalidateTreatment(row.id, data.patientId);
    return { id: row.id, caseNumber: row.case_number };
  });
}

export async function addSession(
  input: ActionInput<typeof addSessionSchema>,
): Promise<ActionResult<CaseVisit>> {
  return actionResult(async () => {
    const user = await requirePermission("session:record");
    const data = addSessionSchema.parse(input);
    await requireCaseWriteAccess(data.caseId);
    await enforceWriteRateLimit("followupCreate", user.id);

    const admin = createSupabaseAdminClient();
    const { data: row, error } = await admin
      .rpc("add_treatment_session", {
        p_case_id: data.caseId,
        p_visit_date: data.visitDate,
        p_doctor_id: data.doctorId,
        p_observation: data.observation,
        p_next_visit_date: data.nextVisitDate,
        p_actor: user.id,
      })
      .single<CaseVisit>();

    if (error || !row) throw rpcError(error, "The session could not be added.");

    revalidateTreatment(data.caseId);
    return row;
  });
}

export async function completeSession(
  input: ActionInput<typeof completeSessionSchema>,
): Promise<ActionResult<CaseVisit>> {
  return actionResult(async () => {
    const user = await requirePermission("session:record");
    const data = completeSessionSchema.parse(input);
    await requireCaseWriteAccess(data.caseId);

    const admin = createSupabaseAdminClient();
    const { data: row, error } = await admin
      .rpc("complete_treatment_session", { p_visit_id: data.visitId, p_actor: user.id })
      .single<CaseVisit>();

    if (error || !row) throw rpcError(error, "The session could not be completed.");
    if (row.case_id !== data.caseId) throw rpcError(null, "The session could not be completed.");

    revalidateTreatment(data.caseId);
    return row;
  });
}

export async function markForSurgery(
  input: ActionInput<typeof markForSurgerySchema>,
): Promise<ActionResult<{ surgeryDate: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("surgery:schedule");
    const data = markForSurgerySchema.parse(input);
    await requireCaseWriteAccess(data.caseId);

    const admin = createSupabaseAdminClient();
    const { data: row, error } = await admin
      .rpc("mark_case_for_surgery", {
        p_case_id: data.caseId,
        p_surgery_date: data.surgeryDate,
        p_surgeon_id: data.surgeonId,
        p_actor: user.id,
      })
      .single<CaseRow>();

    if (error || !row) throw rpcError(error, "The surgery could not be scheduled.");

    revalidateTreatment(data.caseId, row.patient_id);
    return { surgeryDate: row.surgery_date ?? data.surgeryDate };
  });
}

export async function cancelSurgery(
  input: ActionInput<typeof cancelSurgerySchema>,
): Promise<ActionResult<{ caseId: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("surgery:schedule");
    const data = cancelSurgerySchema.parse(input);
    await requireCaseWriteAccess(data.caseId);

    const admin = createSupabaseAdminClient();
    const { data: row, error } = await admin
      .rpc("cancel_surgery_schedule", { p_case_id: data.caseId, p_actor: user.id })
      .single<CaseRow>();

    if (error || !row) throw rpcError(error, "The surgery could not be cancelled.");

    revalidateTreatment(data.caseId, row.patient_id);
    return { caseId: data.caseId };
  });
}
