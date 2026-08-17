/**
 * Domain row shapes mirroring the SQL migrations under `supabase/migrations`.
 * Query helpers apply these with `.returns<T>()` so the app is typed end to end.
 */

export const ROLE_CODES = ["ADMIN", "SURGEON", "STAFF", "VIEWER"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const CASE_STATUSES = ["ACTIVE", "COMPLETED", "ARCHIVED"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const VISIT_TYPES = ["BEFORE", "FOLLOW_UP"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export const IMAGE_AVAILABILITY = ["UPLOADED", "MISSING", "NOT_AVAILABLE"] as const;
export type ImageAvailability = (typeof IMAGE_AVAILABILITY)[number];

export const REVIEW_STATUSES = ["PENDING", "IN_REVIEW", "COMPLETED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const MASTER_TABLES = [
  "procedures",
  "procedure_types",
  "complication_types",
  "clinical_tags",
  "followup_label_presets",
] as const;
export type MasterTable = (typeof MASTER_TABLES)[number];

export type MasterValue = {
  id: string;
  normalized_key: string;
  display_name: string;
  is_active: boolean;
  usage_count: number;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  months_after_surgery?: number | null;
};

export type Profile = {
  id: string;
  display_name: string;
  role_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProfileWithRole = Profile & {
  role_code: RoleCode;
  role_name: string;
  email?: string | null;
  last_sign_in_at?: string | null;
};

export type ImageViewType = {
  id: string;
  code: string;
  display_name: string;
  sort_order: number;
  is_standard: boolean;
  is_active: boolean;
};

export type CaseRow = {
  id: string;
  case_number: string;
  procedure_id: string;
  procedure_type_id: string;
  surgery_date: string;
  status: CaseStatus;
  followup_availability: string | null;
  archived_at: string | null;
  archived_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type CaseListRow = {
  id: string;
  case_number: string;
  procedure_id: string;
  procedure_name: string;
  procedure_type_id: string;
  procedure_type_name: string;
  surgery_date: string;
  status: CaseStatus;
  followup_availability: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
  latest_followup_date: string | null;
  latest_followup_label: string | null;
  followup_count: number;
  image_use_consent: boolean | null;
  consent_recorded_at: string | null;
  review_status: ReviewStatus;
  reviewed_at: string | null;
  before_uploaded_count: number | null;
  before_not_available_count: number | null;
  standard_view_count: number;
};

export type CaseVisit = {
  id: string;
  case_id: string;
  visit_type: VisitType;
  visit_date: string | null;
  display_label: string;
  months_after_surgery: number | null;
  clinical_observation: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ClinicalImageVersion = {
  id: string;
  clinical_image_id: string;
  bucket: string;
  object_key: string;
  original_filename: string | null;
  mime_type: string;
  file_size: number;
  sha256: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  superseded_at: string | null;
  superseded_by: string | null;
};

export type ClinicalImage = {
  id: string;
  case_id: string;
  visit_id: string;
  view_type_id: string;
  availability_status: ImageAvailability;
  current_version_id: string | null;
  not_available_reason: string | null;
  not_available_by: string | null;
  not_available_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A view slot as rendered in the UI: always present, possibly empty. */
export type ImageSlot = {
  viewType: ImageViewType;
  image: ClinicalImage | null;
  currentVersion: ClinicalImageVersion | null;
  uploadedByName: string | null;
};

export type CaseNotes = {
  id: string;
  case_id: string;
  patient_concern: string | null;
  preop_assessment: string | null;
  treatment_recommendation: string | null;
  preop_aesthetic_goal: string | null;
  dorsum: string | null;
  tip: string | null;
  projection: string | null;
  rotation: string | null;
  alar: string | null;
  septum: string | null;
  other_anatomical_change: string | null;
  surgeon_assessment: string | null;
  outcome: string | null;
  patient_satisfaction: string | null;
  complications_present: boolean | null;
  complication_type_id: string | null;
  complication_details: string | null;
  revision_required: boolean | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  version: number;
};

export type CaseChangePerformed = {
  id: string;
  case_id: string;
  description: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CaseConsent = {
  id: string;
  case_id: string;
  image_use_consent: boolean;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
  created_at: string;
};

export type CaseReview = {
  id: string;
  case_id: string;
  status: ReviewStatus;
  final_assessment: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type AuditLog = {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  case_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

/** Shape returned by the `case_completion(uuid)` SQL function. */
export type CaseCompletionFacts = {
  case_information: boolean;
  before_images: boolean;
  before_images_resolved: number;
  standard_view_count: number;
  followups: boolean;
  followup_count: number;
  case_notes: boolean;
  consent: boolean;
  expert_review: boolean;
};

export type ConsentState = "YES" | "NO" | "NOT_RECORDED";
