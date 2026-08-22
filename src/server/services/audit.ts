import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logServerError } from "@/lib/errors";

/**
 * Audit event recording.
 *
 * Metadata records *what changed*, not the clinical content itself: field names
 * and safe scalar values only. Free-text note bodies are never copied into the
 * log, which would otherwise duplicate sensitive narrative into a table with a
 * different access profile.
 */

export const AUDIT_ACTIONS = [
  "USER_CREATED",
  "USER_UPDATED",
  "USER_DISABLED",
  "PROFILE_UPDATED",
  "PASSWORD_CHANGED",
  "AVATAR_UPDATED",
  "USER_ENABLED",
  "CASE_CREATED",
  "CASE_UPDATED",
  "CASE_ARCHIVED",
  "CASE_RESTORED",
  "FOLLOWUP_CREATED",
  "FOLLOWUP_UPDATED",
  "FOLLOWUP_DELETED",
  "IMAGE_UPLOAD_STARTED",
  "IMAGE_UPLOADED",
  "IMAGE_REPLACED",
  "IMAGE_UPLOAD_ABANDONED",
  "IMAGE_UPLOAD_RECOVERED",
  "IMAGE_UPLOAD_SWEPT",
  "IMAGE_MARKED_NOT_AVAILABLE",
  "IMAGE_AVAILABILITY_CLEARED",
  "IMAGE_REMOVED",
  "IMAGE_DOWNLOADED",
  "VISIT_IMAGES_SUBMITTED",
  "VISIT_IMAGES_UPDATED",
  "EDIT_REQUEST_CREATED",
  "EDIT_REQUEST_APPROVED",
  "EDIT_REQUEST_REJECTED",
  "EDIT_REQUEST_CANCELLED",
  "EDIT_REQUEST_CONSUMED",
  "EDIT_ACCESS_GRANTED",
  "CASE_NOTES_UPDATED",
  "CONSENT_RECORDED",
  "CONSENT_CHANGED",
  "REVIEW_STARTED",
  "REVIEW_UPDATED",
  "REVIEW_COMPLETED",
  "MASTER_VALUE_CREATED",
  "MASTER_VALUE_DISABLED",
  "MASTER_VALUE_ENABLED",
  "STORAGE_PLAN_UPDATED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEvent = {
  actorUserId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  caseId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(event: AuditEvent): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.from("audit_logs").insert({
    actor_user_id: event.actorUserId,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId ?? null,
    case_id: event.caseId ?? null,
    metadata: event.metadata ?? {},
  });

  if (error) {
    // A failed audit write must be visible in operational logs, but it must not
    // roll back a clinical write that already succeeded.
    logServerError(new Error(`Audit write failed for ${event.action}: ${error.message}`));
  }
}

type Scalar = string | number | boolean | null;

/**
 * Diffs two records into `{ field: { from, to } }`, keeping only the names of
 * changed long-text fields and the values of short scalar ones.
 */
export function diffForAudit(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  options: { redactFields?: string[] } = {},
): { changedFields: string[]; changes: Record<string, { from: Scalar; to: Scalar }> } {
  const redact = new Set(options.redactFields ?? []);
  const changedFields: string[] = [];
  const changes: Record<string, { from: Scalar; to: Scalar }> = {};

  for (const key of Object.keys(after)) {
    const from = before[key];
    const to = after[key];

    if (Object.is(from ?? null, to ?? null)) continue;
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue;

    changedFields.push(key);

    if (redact.has(key)) continue;

    changes[key] = { from: safeScalar(from), to: safeScalar(to) };
  }

  return { changedFields, changes };
}

/** Long or non-scalar values collapse to a shape description, never content. */
function safeScalar(value: unknown): Scalar {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;

  if (typeof value === "string") {
    return value.length <= 80 ? value : `[${value.length} characters]`;
  }

  return `[${typeof value}]`;
}
