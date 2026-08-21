import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, notFound } from "@/lib/errors";
import { caseNumberSearchPatterns } from "@/lib/case-number";
import { listCaseEditRequests } from "@/server/queries/notifications";
import type { CaseListQuery } from "@/lib/validation/schemas";
import type {
  CaseChangePerformed,
  CaseCompletionFacts,
  CaseConsent,
  CaseEditRequestRow,
  CaseListRow,
  CaseNotes,
  CaseReview,
  CaseVisit,
  ClinicalImage,
  ClinicalImageVersion,
  ConsentState,
  ImageSlot,
  ImageViewType,
  MasterValue,
} from "@/lib/types";

/**
 * Read side of the cases feature.
 *
 * Every list query is paginated and filtered in PostgreSQL. The browser never
 * receives the full case set, and no query fans out into per-row follow-up
 * lookups — `case_list_view` does that work once, in SQL.
 */

export type CaseListResult = {
  rows: CaseListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export async function listCases(query: CaseListQuery): Promise<CaseListResult> {
  const supabase = await createSupabaseServerClient();

  let request = supabase.from("case_list_view").select("*", { count: "exact" });

  if (query.status === "any") {
    // "Any" still means "not archived" — archived cases have their own filter.
    request = request.is("archived_at", null);
  } else if (query.status === "ARCHIVED") {
    request = request.not("archived_at", "is", null);
  } else {
    request = request.eq("status", query.status).is("archived_at", null);
  }

  if (query.q) {
    const patterns = caseNumberSearchPatterns(query.q);
    const escaped = escapeOrValue(query.q);

    const clauses = [
      ...patterns.map((pattern) => `case_number.ilike.${escapeOrValue(pattern)}`),
      `procedure_name.ilike.%${escaped}%`,
      `procedure_type_name.ilike.%${escaped}%`,
    ];

    request = request.or(clauses.join(","));
  }

  if (query.procedureId) request = request.eq("procedure_id", query.procedureId);
  if (query.procedureTypeId) request = request.eq("procedure_type_id", query.procedureTypeId);
  if (query.surgeryFrom) request = request.gte("surgery_date", query.surgeryFrom);
  if (query.surgeryTo) request = request.lte("surgery_date", query.surgeryTo);

  if (query.hasFollowups === "yes") request = request.gt("followup_count", 0);
  if (query.hasFollowups === "no") request = request.eq("followup_count", 0);

  if (query.consent === "yes") request = request.eq("image_use_consent", true);
  if (query.consent === "no") request = request.eq("image_use_consent", false);
  if (query.consent === "not_recorded") request = request.is("image_use_consent", null);

  if (query.reviewStatus !== "any") request = request.eq("review_status", query.reviewStatus);

  if (query.completion === "complete") request = request.eq("status", "COMPLETED");
  if (query.completion === "incomplete") request = request.neq("status", "COMPLETED");

  if (query.tagId) {
    const caseIds = await caseIdsForTag(query.tagId);
    if (caseIds.length === 0) {
      return { rows: [], total: 0, page: query.page, pageSize: query.pageSize, pageCount: 0 };
    }
    request = request.in("id", caseIds);
  }

  const from = (query.page - 1) * query.pageSize;

  const { data, error, count } = await request
    .order(query.sort, { ascending: query.direction === "asc", nullsFirst: false })
    .order("id", { ascending: true })
    .range(from, from + query.pageSize - 1)
    .returns<CaseListRow[]>();

  if (error) throw new AppError("INTERNAL", "Could not load cases.");

  const total = count ?? 0;

  return {
    rows: data ?? [],
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

async function caseIdsForTag(tagId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("case_tags")
    .select("case_id")
    .eq("tag_id", tagId)
    .limit(5000)
    .returns<{ case_id: string }[]>();

  return (data ?? []).map((row) => row.case_id);
}

export type CaseDetail = {
  summary: CaseListRow;
  visits: CaseVisit[];
  notes: CaseNotes | null;
  changesPerformed: CaseChangePerformed[];
  consent: CaseConsent | null;
  consentHistory: CaseConsent[];
  consentState: ConsentState;
  review: CaseReview | null;
  reviewerName: string | null;
  tags: MasterValue[];
  completion: CaseCompletionFacts;
  /** Visible to the requester and to administrators; RLS enforces which. */
  editRequests: CaseEditRequestRow[];
};

export async function getCaseDetail(caseId: string): Promise<CaseDetail> {
  const supabase = await createSupabaseServerClient();

  const { data: summary } = await supabase
    .from("case_list_view")
    .select("*")
    .eq("id", caseId)
    .maybeSingle<CaseListRow>();

  if (!summary) throw notFound("This case could not be found, or you cannot access it.");

  const [
    visitsRes,
    notesRes,
    changesRes,
    consentRes,
    reviewRes,
    tagsRes,
    completionRes,
    editRequests,
  ] = await Promise.all([
      supabase
        .from("case_visits")
        .select("*")
        .eq("case_id", caseId)
        .order("visit_type", { ascending: true })
        .order("visit_date", { ascending: true, nullsFirst: true })
        .returns<CaseVisit[]>(),
      supabase.from("case_notes").select("*").eq("case_id", caseId).maybeSingle<CaseNotes>(),
      supabase
        .from("case_changes_performed")
        .select("*")
        .eq("case_id", caseId)
        .order("sort_order", { ascending: true })
        .returns<CaseChangePerformed[]>(),
      supabase
        .from("case_consents")
        .select("*")
        .eq("case_id", caseId)
        .order("recorded_at", { ascending: false })
        .returns<CaseConsent[]>(),
      supabase.from("case_reviews").select("*").eq("case_id", caseId).maybeSingle<CaseReview>(),
      supabase
        .from("case_tags")
        .select("clinical_tags(*)")
        .eq("case_id", caseId)
        .returns<{ clinical_tags: MasterValue }[]>(),
      supabase.rpc("case_completion", { p_case_id: caseId }),
      listCaseEditRequests(caseId),
    ]);

  const consentHistory = consentRes.data ?? [];
  const consent = consentHistory[0] ?? null;

  let reviewerName: string | null = null;
  if (reviewRes.data?.reviewer_id) {
    const { data: reviewer } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", reviewRes.data.reviewer_id)
      .maybeSingle<{ display_name: string }>();
    reviewerName = reviewer?.display_name ?? null;
  }

  return {
    summary,
    visits: visitsRes.data ?? [],
    notes: notesRes.data ?? null,
    changesPerformed: changesRes.data ?? [],
    consent,
    consentHistory,
    consentState: consent === null ? "NOT_RECORDED" : consent.image_use_consent ? "YES" : "NO",
    review: reviewRes.data ?? null,
    reviewerName,
    tags: (tagsRes.data ?? []).map((row) => row.clinical_tags).filter(Boolean),
    completion: (completionRes.data as CaseCompletionFacts) ?? emptyCompletion(),
    editRequests,
  };
}

function emptyCompletion(): CaseCompletionFacts {
  return {
    case_information: false,
    before_images: false,
    before_images_resolved: 0,
    after_images: false,
    after_images_resolved: 0,
    standard_view_count: 6,
    followups: false,
    followup_count: 0,
    case_notes: false,
    consent: false,
    expert_review: false,
  };
}

export async function listStandardViewTypes(): Promise<ImageViewType[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("image_view_types")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<ImageViewType[]>();

  if (error) throw new AppError("INTERNAL", "Could not load image view types.");

  return data ?? [];
}

/**
 * The six (or more) view slots for a visit, always returned in full so the UI
 * renders an explicit empty state for every expected view.
 */
export async function getVisitImageSlots(visitId: string): Promise<ImageSlot[]> {
  const supabase = await createSupabaseServerClient();
  const viewTypes = await listStandardViewTypes();

  const { data: images } = await supabase
    .from("clinical_images")
    .select("*")
    .eq("visit_id", visitId)
    .returns<ClinicalImage[]>();

  const imageList = images ?? [];
  const versionIds = imageList
    .map((image) => image.current_version_id)
    .filter((id): id is string => Boolean(id));

  let versions: ClinicalImageVersion[] = [];
  let uploaderNames = new Map<string, string>();

  if (versionIds.length > 0) {
    const { data } = await supabase
      .from("clinical_image_versions")
      .select("*")
      .in("id", versionIds)
      .returns<ClinicalImageVersion[]>();

    versions = data ?? [];

    const uploaderIds = [
      ...new Set(versions.map((v) => v.uploaded_by).filter((id): id is string => Boolean(id))),
    ];

    if (uploaderIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", uploaderIds)
        .returns<{ id: string; display_name: string }[]>();

      uploaderNames = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
    }
  }

  return viewTypes.map((viewType) => {
    const image = imageList.find((candidate) => candidate.view_type_id === viewType.id) ?? null;
    const currentVersion = image?.current_version_id
      ? (versions.find((version) => version.id === image.current_version_id) ?? null)
      : null;

    return {
      viewType,
      image,
      currentVersion,
      uploadedByName: currentVersion?.uploaded_by
        ? (uploaderNames.get(currentVersion.uploaded_by) ?? null)
        : null,
    };
  });
}

/** Full replacement history for one slot, newest first. */
export async function getImageVersionHistory(
  clinicalImageId: string,
): Promise<(ClinicalImageVersion & { uploaded_by_name: string | null })[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("clinical_image_versions")
    .select("*")
    .eq("clinical_image_id", clinicalImageId)
    .order("uploaded_at", { ascending: false })
    .returns<ClinicalImageVersion[]>();

  const versions = data ?? [];
  const uploaderIds = [
    ...new Set(versions.map((v) => v.uploaded_by).filter((id): id is string => Boolean(id))),
  ];

  const names = new Map<string, string>();
  if (uploaderIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", uploaderIds)
      .returns<{ id: string; display_name: string }[]>();

    for (const profile of profiles ?? []) names.set(profile.id, profile.display_name);
  }

  return versions.map((version) => ({
    ...version,
    uploaded_by_name: version.uploaded_by ? (names.get(version.uploaded_by) ?? null) : null,
  }));
}

/** PostgREST `or()` uses commas and parens as syntax; quote values containing them. */
function escapeOrValue(value: string): string {
  return /[,()]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}
