import "server-only";

import { cache } from "react";

import { AppError, notFound } from "@/lib/errors";
import { fileIdSearchPrefix, normalizeFileIdInput } from "@/lib/file-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PatientListQuery } from "@/lib/validation/schemas";
import type {
  Branch,
  CaseListRow,
  CaseVisit,
  PatientConsultation,
  PatientDocument,
  PatientListRow,
  PatientNote,
  SurgeryReminder,
} from "@/lib/types";

/**
 * Read side of patients. Everything goes through the user's own session, so
 * `patients` RLS decides: active ADMIN and DOCTOR users at every branch, never
 * VIEWER. Patient names and phones are rendered on these pages and nowhere
 * else — not in titles, URLs, logs or push text.
 */

export type PatientListResult = {
  rows: PatientListRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** One search box for File ID, name or phone — the filter is picked by shape. */
function applySearch<T extends { ilike: (c: string, p: string) => T; or: (f: string) => T }>(
  request: T,
  raw: string,
): T {
  const q = raw.trim();
  if (!q) return request;

  const prefix = fileIdSearchPrefix(q);
  if (prefix) {
    // "kl5" must find KL0005 (the padded File ID people mean) as well as
    // KL5xxx prefixes. Both values are [A-Z0-9] only, so safe in the filter.
    const exact = normalizeFileIdInput(q);
    return exact && exact !== prefix
      ? request.or(`file_id.ilike.${prefix}%,file_id.eq.${exact}`)
      : request.ilike("file_id", `${prefix}%`);
  }

  const digits = q.replace(/[^0-9]/g, "");
  if (digits.length >= 4 && digits.length >= q.replace(/\s/g, "").length - 2) {
    return request.ilike("phone", `%${digits.slice(-10)}%`);
  }

  // Strip LIKE wildcards so a search for "100%" means the literal text.
  const term = q.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
  return term ? request.ilike("full_name", `%${term}%`) : request;
}

export async function listPatients(query: PatientListQuery): Promise<PatientListResult> {
  const supabase = await createSupabaseServerClient();

  let request = supabase
    .from("patient_list_view")
    .select("*", { count: "exact" })
    .is("archived_at", null);

  request = applySearch(request, query.q);
  if (query.branchId) request = request.eq("branch_id", query.branchId);

  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await request
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + query.pageSize - 1)
    .returns<PatientListRow[]>();

  if (error) throw new AppError("INTERNAL", "Could not load patients.");

  return { rows: data ?? [], total: count ?? 0, page: query.page, pageSize: query.pageSize };
}

export type PatientSearchHit = Pick<
  PatientListRow,
  "id" | "file_id" | "full_name" | "branch_code" | "referred_for_name" | "active_treatments"
>;

/** Command palette lookup: small, fast, exact-prefix on File ID first. */
export async function searchPatients(q: string, limit = 8): Promise<PatientSearchHit[]> {
  if (!q.trim()) return [];
  const supabase = await createSupabaseServerClient();

  const request = applySearch(
    supabase
      .from("patient_list_view")
      .select("id, file_id, full_name, branch_code, referred_for_name, active_treatments")
      .is("archived_at", null),
    q,
  );

  const { data, error } = await request.order("file_id", { ascending: true }).limit(limit).returns<PatientSearchHit[]>();
  if (error) throw new AppError("INTERNAL", "Could not search patients.");
  return data ?? [];
}

export type NamedConsultation = PatientConsultation & { doctor_name: string | null; branch_code: string | null };
export type NamedNote = PatientNote & { author_name: string | null; case_number: string | null };
export type NamedDocument = PatientDocument & { uploader_name: string | null };
export type SessionVisit = CaseVisit & { doctor_name: string | null };

export type PatientDetail = {
  patient: PatientListRow;
  treatments: CaseListRow[];
  sessions: SessionVisit[];
  consultations: NamedConsultation[];
  notes: NamedNote[];
  documents: NamedDocument[];
  reminders: SurgeryReminder[];
};

/** Cached per request: the page and its metadata share one load. */
export const getPatientDetail = cache(async function getPatientDetail(
  patientId: string,
): Promise<PatientDetail> {
  const supabase = await createSupabaseServerClient();

  const { data: patient } = await supabase
    .from("patient_list_view")
    .select("*")
    .eq("id", patientId)
    .maybeSingle<PatientListRow>();

  if (!patient) throw notFound("This patient could not be found, or you cannot access them.");

  const [treatmentsRes, consultationsRes, notesRes, documentsRes] = await Promise.all([
    supabase
      .from("case_list_view")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .returns<CaseListRow[]>(),
    supabase
      .from("patient_consultations")
      .select("*")
      .eq("patient_id", patientId)
      .order("visit_date", { ascending: false })
      .returns<PatientConsultation[]>(),
    supabase
      .from("patient_notes")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(200)
      .returns<PatientNote[]>(),
    supabase
      .from("patient_documents")
      .select("id, patient_id, consultation_id, kind, original_filename, mime_type, file_size, uploaded_by, uploaded_at, superseded_at")
      .eq("patient_id", patientId)
      .is("superseded_at", null)
      .order("uploaded_at", { ascending: false })
      .returns<PatientDocument[]>(),
  ]);

  const treatments = treatmentsRes.data ?? [];
  const caseIds = treatments.map((t) => t.id);

  const [sessionsRes, remindersRes] = await Promise.all([
    caseIds.length
      ? supabase
          .from("case_visits")
          .select("*")
          .in("case_id", caseIds)
          .eq("visit_type", "SESSION")
          .order("visit_date", { ascending: false })
          .returns<CaseVisit[]>()
      : Promise.resolve({ data: [] as CaseVisit[] }),
    caseIds.length
      ? supabase
          .from("surgery_reminders")
          .select("*")
          .in("case_id", caseIds)
          .eq("status", "PENDING")
          .order("remind_at", { ascending: true })
          .returns<SurgeryReminder[]>()
      : Promise.resolve({ data: [] as SurgeryReminder[] }),
  ]);

  const consultations = consultationsRes.data ?? [];
  const notes = notesRes.data ?? [];
  const documents = documentsRes.data ?? [];
  const sessions = sessionsRes.data ?? [];

  const profileIds = new Set<string>();
  for (const c of consultations) if (c.doctor_id) profileIds.add(c.doctor_id);
  for (const n of notes) if (n.author_id) profileIds.add(n.author_id);
  for (const d of documents) if (d.uploaded_by) profileIds.add(d.uploaded_by);
  for (const s of sessions) if (s.doctor_id) profileIds.add(s.doctor_id);

  const [names, branches] = await Promise.all([profileNames([...profileIds]), listBranches()]);
  const branchCode = new Map(branches.map((b) => [b.id, b.code]));
  const caseNumber = new Map(treatments.map((t) => [t.id, t.case_number]));

  return {
    patient,
    treatments,
    sessions: sessions.map((s) => ({ ...s, doctor_name: s.doctor_id ? (names.get(s.doctor_id) ?? null) : null })),
    consultations: consultations.map((c) => ({
      ...c,
      doctor_name: c.doctor_id ? (names.get(c.doctor_id) ?? null) : null,
      branch_code: branchCode.get(c.branch_id) ?? null,
    })),
    notes: notes.map((n) => ({
      ...n,
      author_name: n.author_id ? (names.get(n.author_id) ?? null) : null,
      case_number: n.case_id ? (caseNumber.get(n.case_id) ?? null) : null,
    })),
    documents: documents.map((d) => ({
      ...d,
      uploader_name: d.uploaded_by ? (names.get(d.uploaded_by) ?? null) : null,
    })),
    reminders: remindersRes.data ?? [],
  };
});

async function profileNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", ids)
    .returns<{ id: string; display_name: string }[]>();
  return new Map((data ?? []).map((p) => [p.id, p.display_name]));
}

export async function listBranches(options: { includeInactive?: boolean } = {}): Promise<Branch[]> {
  const supabase = await createSupabaseServerClient();
  let request = supabase.from("branches").select("*");
  if (!options.includeInactive) request = request.eq("is_active", true);

  const { data, error } = await request
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true })
    .returns<Branch[]>();

  if (error) throw new AppError("INTERNAL", "Could not load branches.");
  return data ?? [];
}

export type DoctorOption = { id: string; display_name: string; branch_id: string | null };

/** Active ADMIN and DOCTOR accounts: referral, surgeon and session pickers. */
export async function listDoctors(): Promise<DoctorOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, branch_id, roles!inner(code)")
    .eq("is_active", true)
    .in("roles.code", ["ADMIN", "DOCTOR"])
    .order("display_name", { ascending: true })
    .returns<(DoctorOption & { roles: { code: string } })[]>();

  if (error) throw new AppError("INTERNAL", "Could not load doctors.");
  return (data ?? []).map(({ id, display_name, branch_id }) => ({ id, display_name, branch_id }));
}

export async function getUserBranchId(userId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("branch_id")
    .eq("id", userId)
    .maybeSingle<{ branch_id: string | null }>();
  return data?.branch_id ?? null;
}
