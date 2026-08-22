/**
 * Domain row shapes mirroring the SQL migrations under `supabase/migrations`.
 * Query helpers apply these with `.returns<T>()` so the app is typed end to end.
 */

export const ROLE_CODES = ["ADMIN", "DOCTOR", "VIEWER"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const CASE_STATUSES = ["ACTIVE", "COMPLETED", "ARCHIVED"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const VISIT_TYPES = ["BEFORE", "AFTER", "FOLLOW_UP"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

/** Scopes that lock after submission and re-open only with admin approval. */
export const EDIT_SCOPES = [
  "CASE_INFORMATION",
  "CASE_NOTES",
  "VISIT_DETAILS",
  "VISIT_IMAGES",
] as const;
export type EditScope = (typeof EDIT_SCOPES)[number];

export const EDIT_REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "CONSUMED",
  "EXPIRED",
] as const;
export type EditRequestStatus = (typeof EDIT_REQUEST_STATUSES)[number];

export const IMAGE_AVAILABILITY = ["UPLOADED", "MISSING", "NOT_AVAILABLE"] as const;

/**
 * Where one photograph stands with the reviewing administrator.
 *
 * Distinct from availability: availability says whether an image exists,
 * this says whether anyone competent has looked at it.
 */
export const IMAGE_REVIEW_STATUSES = ["PENDING", "APPROVED", "REPHOTO_REQUESTED"] as const;
export type ImageReviewStatus = (typeof IMAGE_REVIEW_STATUSES)[number];

/** Derived from the slots, never stored. See `visit_image_review_status`. */
export const VISIT_REVIEW_STATUSES = [
  "NOT_SUBMITTED",
  "PENDING",
  "CHANGES_REQUESTED",
  "APPROVED",
] as const;
export type VisitReviewStatus = (typeof VISIT_REVIEW_STATUSES)[number];
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
  case_visibility_scope: "ALL" | "SELECTED";
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
  information_locked_at: string | null;
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
  information_locked_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  /** Present only in the administrator-only case list view. */
  creator_name?: string | null;
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
  after_uploaded_count: number | null;
  after_not_available_count: number | null;
  standard_view_count: number;
  /** Tag ids on the case, so the list can filter by tag inside PostgreSQL. */
  tag_ids: string[];
};

export type CaseVisit = {
  id: string;
  case_id: string;
  visit_type: VisitType;
  visit_date: string | null;
  display_label: string;
  months_after_surgery: number | null;
  clinical_observation: string | null;
  /** Set when the visit's details were submitted; null means never submitted. */
  details_locked_at: string | null;
  /** Set when the visit's image set was submitted; null means never submitted. */
  images_locked_at: string | null;
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
  review_status: ImageReviewStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A view slot as rendered in the UI: always present, possibly empty. */
export type ImageSlot = {
  viewType: ImageViewType;
  image: ClinicalImage | null;
  currentVersion: ClinicalImageVersion | null;
  uploadedByName: string | null;
  reviewedByName: string | null;
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
  locked_at: string | null;
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

export type CaseReviewComment = {
  id: string;
  case_id: string;
  case_review_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

/** A comment with the author's name resolved for display. */
export type CaseReviewCommentWithAuthor = CaseReviewComment & {
  author_name: string;
  author_role: RoleCode | null;
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
  before_images_approved: number;
  before_images_review: VisitReviewStatus;
  after_images: boolean;
  after_images_resolved: number;
  after_images_approved: number;
  after_images_review: VisitReviewStatus;
  standard_view_count: number;
  followups: boolean;
  followup_count: number;
  case_notes: boolean;
  consent: boolean;
  expert_review: boolean;
};

export type ConsentState = "YES" | "NO" | "NOT_RECORDED";

export type CaseEditRequest = {
  id: string;
  case_id: string;
  scope: EditScope;
  visit_id: string | null;
  status: EditRequestStatus;
  reason: string;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  expires_at: string | null;
  consumed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CaseEditRequestRow = CaseEditRequest & {
  case_number: string;
  visit_label: string | null;
  requested_by_name: string | null;
  decided_by_name: string | null;
};

export type AppNotification = {
  id: string;
  recipient_id: string;
  type: string;
  title: string;
  body: string | null;
  case_id: string | null;
  case_number: string | null;
  visit_id: string | null;
  edit_request_id: string | null;
  /** Context joined at read time; it is not duplicated into the notification row. */
  edit_scope?: EditScope | null;
  /** Lets the notification open the exact related case tab. */
  visit_type?: VisitType | null;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
};

/** One lockable section an administrator can hand over in a decision. */
export type GrantableScope = {
  /** Stable key for React and for round-tripping a selection. */
  key: string;
  scope: EditScope;
  visitId: string | null;
  label: string;
  locked: boolean;
  /** The user already holds a pending or approved request for this section. */
  alreadyOpen: boolean;
};

/**
 * What the current user may do with one lockable scope, resolved server-side.
 * `grantId` is the approval being relied upon, consumed when the save lands.
 */
export type EditAccess = {
  locked: boolean;
  allowed: boolean;
  grantId: string | null;
  /** Set when a request for this scope is already awaiting a decision. */
  pendingRequestId: string | null;
};
