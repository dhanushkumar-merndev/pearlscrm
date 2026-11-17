"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ActionInput } from "@/lib/validation/action-input";
import {
  addPatientNoteSchema,
  createPatientSchema,
  linkCaseToPatientSchema,
  recordConsultationSchema,
  updatePatientSchema,
} from "@/lib/validation/schemas";
import type { PatientConsultation, PatientNote } from "@/lib/types";
import { requirePermission } from "@/server/auth/session";
import { actionResult, type ActionResult } from "@/server/actions/result";
import { searchPatients, type PatientSearchHit } from "@/server/queries/patients";
import { enforceWriteRateLimit } from "@/lib/rate-limit";
import { rpcError } from "@/server/services/rpc-errors";

/**
 * Patient use cases. Each: authenticate → authorise → validate → one RPC that
 * writes and audits atomically (and re-checks the actor) → revalidate.
 */

export async function createPatient(
  input: ActionInput<typeof createPatientSchema>,
): Promise<ActionResult<{ id: string; fileId: string; consultationId: string | null }>> {
  return actionResult(async () => {
    const user = await requirePermission("patient:create");
    const data = createPatientSchema.parse(input);
    await enforceWriteRateLimit("caseCreate", user.id);

    const admin = createSupabaseAdminClient();
    const { data: row, error } = await admin
      .rpc("create_patient", {
        p_branch_id: data.branchId,
        p_full_name: data.fullName,
        p_phone: data.phone,
        p_sex: data.sex,
        p_age_years: data.ageYears,
        p_referred_by_id: data.referredById,
        p_referral_source: data.referralSource,
        p_referred_for_procedure_id: data.referredForProcedureId,
        p_referral_note: data.referralNote,
        p_first_visit_date: data.firstVisitDate,
        p_consultation_notes: data.consultationNotes,
        p_next_visit_date: data.nextVisitDate,
        p_actor: user.id,
      })
      .single<{ id: string; file_id: string }>();

    if (error || !row) throw rpcError(error, "The patient could not be registered.");

    // The first visit is created in the same transaction; its id lets the
    // prescription and the treatment plan attach to it.
    const { data: first } = await admin
      .from("patient_consultations")
      .select("id")
      .eq("patient_id", row.id)
      .eq("is_first_visit", true)
      .maybeSingle<{ id: string }>();

    revalidatePath("/patients");
    return { id: row.id, fileId: row.file_id, consultationId: first?.id ?? null };
  });
}

export async function updatePatient(
  input: ActionInput<typeof updatePatientSchema>,
): Promise<ActionResult<{ id: string; version: number }>> {
  return actionResult(async () => {
    const user = await requirePermission("patient:update");
    const data = updatePatientSchema.parse(input);

    const admin = createSupabaseAdminClient();
    const { data: row, error } = await admin
      .rpc("update_patient", {
        p_patient_id: data.patientId,
        p_expected_version: data.expectedVersion,
        p_full_name: data.fullName,
        p_phone: data.phone,
        p_sex: data.sex,
        p_age_years: data.ageYears,
        p_referred_by_id: data.referredById,
        p_referral_source: data.referralSource,
        p_referred_for_procedure_id: data.referredForProcedureId,
        p_referral_note: data.referralNote,
        p_actor: user.id,
      })
      .single<{ id: string; version: number }>();

    if (error || !row) throw rpcError(error, "The patient could not be updated.");

    revalidatePath(`/patients/${data.patientId}`);
    revalidatePath("/patients");
    return { id: row.id, version: row.version };
  });
}

export async function recordConsultation(
  input: ActionInput<typeof recordConsultationSchema>,
): Promise<ActionResult<PatientConsultation>> {
  return actionResult(async () => {
    const user = await requirePermission("consultation:record");
    const data = recordConsultationSchema.parse(input);

    const admin = createSupabaseAdminClient();
    const { data: row, error } = await admin
      .rpc("record_consultation", {
        p_patient_id: data.patientId,
        p_branch_id: data.branchId,
        p_visit_date: data.visitDate,
        p_notes: data.notes,
        p_next_visit_date: data.nextVisitDate,
        p_actor: user.id,
      })
      .single<PatientConsultation>();

    if (error || !row) throw rpcError(error, "The visit could not be recorded.");

    revalidatePath(`/patients/${data.patientId}`);
    return row;
  });
}

export async function addPatientNote(
  input: ActionInput<typeof addPatientNoteSchema>,
): Promise<ActionResult<PatientNote>> {
  return actionResult(async () => {
    const user = await requirePermission("patient_note:create");
    const data = addPatientNoteSchema.parse(input);

    const admin = createSupabaseAdminClient();
    const { data: row, error } = await admin
      .rpc("add_patient_note", {
        p_patient_id: data.patientId,
        p_case_id: data.caseId,
        p_body: data.body,
        p_next_visit_date: data.nextVisitDate,
        p_actor: user.id,
      })
      .single<PatientNote>();

    if (error || !row) throw rpcError(error, "The note could not be saved.");

    revalidatePath(`/patients/${data.patientId}`);
    return row;
  });
}

export async function linkCaseToPatient(
  input: ActionInput<typeof linkCaseToPatientSchema>,
): Promise<ActionResult<{ caseId: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("patient:link_case");
    const data = linkCaseToPatientSchema.parse(input);

    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc("link_case_to_patient", {
      p_case_id: data.caseId,
      p_patient_id: data.patientId,
      p_actor: user.id,
    });

    if (error) throw rpcError(error, "The case could not be linked.");

    revalidatePath(`/cases/${data.caseId}`);
    revalidatePath(`/patients/${data.patientId}`);
    return { caseId: data.caseId };
  });
}

/** Ctrl/⌘K lookup. Runs as the user, so patients RLS applies. */
export async function searchPatientsAction(input: { q: string }): Promise<ActionResult<PatientSearchHit[]>> {
  return actionResult(async () => {
    await requirePermission("patient:read");
    const q = typeof input?.q === "string" ? input.q.slice(0, 100) : "";
    return searchPatients(q);
  });
}
