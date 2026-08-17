import { z } from "zod";

import { isIsoDate } from "@/lib/dates";
import { ALLOWED_IMAGE_MIME_TYPES } from "@/lib/images";
import { MASTER_TABLES, REVIEW_STATUSES } from "@/lib/types";
import { MAX_MASTER_VALUE_LENGTH } from "@/lib/master-data";

/**
 * One schema set, used by the browser for UX and re-run on the server for
 * security. The server never trusts a client-side pass.
 */

export const uuid = z.string().uuid("Expected a valid identifier");

export const isoDate = z
  .string()
  .refine((value) => isIsoDate(value), "Expected a valid date");

/** Trims but preserves intentional line breaks inside long-form clinical text. */
const narrative = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n/g, "\n").trim())
    .pipe(z.string().max(max, `Must be ${max.toLocaleString()} characters or fewer`));

const optionalNarrative = (max: number) =>
  narrative(max)
    .optional()
    .transform((value) => (value === "" ? null : (value ?? null)));

// --- Auth --------------------------------------------------------------------

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});

export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(12, "Use at least 12 characters")
      .max(128, "Use 128 characters or fewer"),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// --- Master data -------------------------------------------------------------

export const masterTableSchema = z.enum(MASTER_TABLES);

export const createMasterValueSchema = z.object({
  table: masterTableSchema,
  displayName: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1, "Enter a value")
        .max(MAX_MASTER_VALUE_LENGTH, `Use ${MAX_MASTER_VALUE_LENGTH} characters or fewer`),
    ),
});

export const searchMasterValuesSchema = z.object({
  table: masterTableSchema,
  query: z.string().max(200).optional().default(""),
  includeInactiveId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const setMasterValueActiveSchema = z.object({
  table: masterTableSchema,
  id: uuid,
  isActive: z.boolean(),
});

// --- Cases -------------------------------------------------------------------

export const createCaseSchema = z.object({
  procedureId: uuid,
  procedureTypeId: uuid,
  surgeryDate: isoDate,
  followupAvailability: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : null)),
  consent: z.enum(["YES", "NO", "NOT_RECORDED"]).default("NOT_RECORDED"),
  consentNotes: optionalNarrative(2000),
  tagIds: z.array(uuid).max(20).default([]),
});

export const updateCaseSchema = z.object({
  caseId: uuid,
  procedureId: uuid,
  procedureTypeId: uuid,
  surgeryDate: isoDate,
  followupAvailability: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : null)),
  tagIds: z.array(uuid).max(20).default([]),
  expectedVersion: z.coerce.number().int().min(1),
});

export const archiveCaseSchema = z.object({
  caseId: uuid,
  reason: z.string().trim().max(500).optional(),
});

export const restoreCaseSchema = z.object({ caseId: uuid });

export const caseListQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  procedureId: uuid.optional(),
  procedureTypeId: uuid.optional(),
  surgeryFrom: isoDate.optional(),
  surgeryTo: isoDate.optional(),
  hasFollowups: z.enum(["any", "yes", "no"]).default("any"),
  consent: z.enum(["any", "yes", "no", "not_recorded"]).default("any"),
  reviewStatus: z.enum(["any", ...REVIEW_STATUSES]).default("any"),
  completion: z.enum(["any", "complete", "incomplete"]).default("any"),
  status: z.enum(["any", "ACTIVE", "COMPLETED", "ARCHIVED"]).default("ACTIVE"),
  tagId: uuid.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
  sort: z
    .enum(["case_number", "surgery_date", "created_at", "latest_followup_date"])
    .default("created_at"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

export type CaseListQuery = z.infer<typeof caseListQuerySchema>;

// --- Visits ------------------------------------------------------------------

export const createFollowupSchema = z.object({
  caseId: uuid,
  visitDate: isoDate,
  displayLabel: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, "Enter a label").max(100, "Use 100 characters or fewer")),
  clinicalObservation: optionalNarrative(10000),
});

export const updateVisitSchema = z.object({
  visitId: uuid,
  visitDate: isoDate.optional(),
  displayLabel: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, "Enter a label").max(100))
    .optional(),
  clinicalObservation: optionalNarrative(10000),
});

export const deleteVisitSchema = z.object({ visitId: uuid });

// --- Images ------------------------------------------------------------------

export const getUploadUrlSchema = z.object({
  caseId: uuid,
  visitId: uuid,
  viewTypeId: uuid,
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES),
  fileSize: z.coerce.number().int().positive(),
});

export const finalizeUploadSchema = z.object({
  uploadSessionId: uuid,
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 hex digest")
    .optional(),
});

export const abandonUploadSchema = z.object({ uploadSessionId: uuid });

export const imageReadUrlSchema = z.object({
  imageId: uuid,
  versionId: uuid.optional(),
  download: z.coerce.boolean().optional().default(false),
});

export const markImageUnavailableSchema = z.object({
  caseId: uuid,
  visitId: uuid,
  viewTypeId: uuid,
  reason: z.string().trim().max(500).optional(),
});

export const clearImageUnavailableSchema = z.object({
  visitId: uuid,
  viewTypeId: uuid,
});

// --- Case notes --------------------------------------------------------------

export const changePerformedSchema = z.object({
  id: uuid.optional(),
  description: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, "Describe the change").max(2000)),
});

export const updateCaseNotesSchema = z.object({
  caseId: uuid,
  expectedVersion: z.coerce.number().int().min(1),

  patientConcern: optionalNarrative(20000),
  preopAssessment: optionalNarrative(20000),
  treatmentRecommendation: optionalNarrative(20000),
  preopAestheticGoal: optionalNarrative(20000),

  dorsum: optionalNarrative(20000),
  tip: optionalNarrative(20000),
  projection: optionalNarrative(20000),
  rotation: optionalNarrative(20000),
  alar: optionalNarrative(20000),
  septum: optionalNarrative(20000),
  otherAnatomicalChange: optionalNarrative(20000),

  surgeonAssessment: optionalNarrative(20000),
  outcome: optionalNarrative(20000),
  patientSatisfaction: optionalNarrative(20000),

  complicationsPresent: z.boolean().nullable().default(null),
  complicationTypeId: uuid.nullable().optional().default(null),
  complicationDetails: optionalNarrative(20000),

  revisionRequired: z.boolean().nullable().default(null),

  changesPerformed: z.array(changePerformedSchema).max(50).default([]),
});

export type UpdateCaseNotesInput = z.infer<typeof updateCaseNotesSchema>;

// --- Consent -----------------------------------------------------------------

export const recordConsentSchema = z.object({
  caseId: uuid,
  imageUseConsent: z.boolean(),
  notes: optionalNarrative(2000),
});

// --- Expert review -----------------------------------------------------------

export const updateReviewSchema = z.object({
  caseId: uuid,
  status: z.enum(REVIEW_STATUSES),
  finalAssessment: optionalNarrative(20000),
  expectedVersion: z.coerce.number().int().min(1),
});

// --- Users -------------------------------------------------------------------

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  displayName: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, "Enter a name").max(120)),
  roleCode: z.enum(["ADMIN", "SURGEON", "STAFF", "VIEWER"]),
});

export const updateUserSchema = z.object({
  userId: uuid,
  displayName: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(120))
    .optional(),
  roleCode: z.enum(["ADMIN", "SURGEON", "STAFF", "VIEWER"]).optional(),
  isActive: z.boolean().optional(),
});

// --- Audit -------------------------------------------------------------------

export const auditQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  actorId: uuid.optional(),
  action: z.string().trim().max(80).optional(),
  caseId: uuid.optional(),
  entityType: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(50),
});
