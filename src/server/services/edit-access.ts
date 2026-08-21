import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { forbidden, notFound } from "@/lib/errors";
import type { CaseEditRequest, EditAccess, EditScope } from "@/lib/types";
import type { SessionUser } from "@/server/auth/session";

/**
 * Submission locks and the admin approval that reopens them.
 *
 * A clinical record is freely editable until it is submitted. After that the
 * scope is closed, and writing to it again requires an administrator to have
 * approved a written request from *this* user for *this* scope. The approval is
 * single use: the save that relies on it consumes it, so the next edit asks
 * again.
 *
 * This module is the only place that decision is made. Every server action that
 * writes into a lockable scope calls `requireEditAccess` before it writes and
 * `consumeEditGrant` after the write succeeds — hiding an Edit button is not
 * the control.
 */

export type ScopeTarget =
  | { scope: "CASE_INFORMATION"; caseId: string }
  | { scope: "CASE_NOTES"; caseId: string }
  | { scope: "VISIT_DETAILS"; caseId: string; visitId: string }
  | { scope: "VISIT_IMAGES"; caseId: string; visitId: string };

export function scopeVisitId(target: ScopeTarget): string | null {
  return target.scope === "VISIT_DETAILS" || target.scope === "VISIT_IMAGES"
    ? target.visitId
    : null;
}

/** Human wording used in error messages and in the request dialog. */
export function scopeLabel(scope: EditScope, visitLabel?: string | null): string {
  if (scope === "CASE_INFORMATION") return "case information";
  if (scope === "CASE_NOTES") return "case notes";
  if (scope === "VISIT_DETAILS") return `${visitLabel ?? "visit"} details`;
  return `${visitLabel ?? "visit"} images`;
}

/** Whether the scope has been submitted, i.e. is closed to unapproved edits. */
async function isLocked(target: ScopeTarget): Promise<boolean> {
  const supabase = await createSupabaseServerClient();

  if (target.scope === "CASE_INFORMATION") {
    const { data } = await supabase
      .from("cases")
      .select("information_locked_at")
      .eq("id", target.caseId)
      .maybeSingle<{ information_locked_at: string | null }>();

    if (!data) throw notFound("This case could not be found, or you cannot access it.");

    return data.information_locked_at !== null;
  }

  if (target.scope === "CASE_NOTES") {
    const { data } = await supabase
      .from("case_notes")
      .select("locked_at")
      .eq("case_id", target.caseId)
      .maybeSingle<{ locked_at: string | null }>();

    if (!data) throw notFound("Case notes for this case could not be found.");

    return data.locked_at !== null;
  }

  const { data } = await supabase
    .from("case_visits")
    .select("case_id, details_locked_at, images_locked_at")
    .eq("id", target.visitId)
    .maybeSingle<{
      case_id: string;
      details_locked_at: string | null;
      images_locked_at: string | null;
    }>();

  if (!data) throw notFound("This visit could not be found.");
  if (data.case_id !== target.caseId) throw forbidden("That visit does not belong to this case.");

  return target.scope === "VISIT_DETAILS"
    ? data.details_locked_at !== null
    : data.images_locked_at !== null;
}

/**
 * The user's standing with one scope: is it locked, may they write to it now,
 * which grant would that rely on, and is a request already awaiting a decision.
 */
export async function resolveEditAccess(
  user: SessionUser,
  target: ScopeTarget,
): Promise<EditAccess> {
  const locked = await isLocked(target);

  // Administrators are the approvers; there is nobody above them to ask.
  if (!locked || user.role === "ADMIN") {
    return { locked, allowed: true, grantId: null, pendingRequestId: null };
  }

  const supabase = await createSupabaseServerClient();
  const visitId = scopeVisitId(target);

  let request = supabase
    .from("case_edit_requests")
    .select("id, status, expires_at")
    .eq("case_id", target.caseId)
    .eq("scope", target.scope)
    .eq("requested_by", user.id)
    .in("status", ["PENDING", "APPROVED"]);

  request = visitId === null ? request.is("visit_id", null) : request.eq("visit_id", visitId);

  const { data: open } = await request.returns<
    Pick<CaseEditRequest, "id" | "status" | "expires_at">[]
  >();

  const now = Date.now();

  const grant = (open ?? []).find(
    (row) =>
      row.status === "APPROVED" &&
      (row.expires_at === null || Date.parse(row.expires_at) > now),
  );

  const pending = (open ?? []).find((row) => row.status === "PENDING");

  return {
    locked,
    allowed: Boolean(grant),
    grantId: grant?.id ?? null,
    pendingRequestId: pending?.id ?? null,
  };
}

/**
 * Throws unless the user may write to the scope right now. Returns the grant id
 * that authorized the write, or null when no grant was needed — pass it to
 * `consumeEditGrant` once the write has succeeded.
 */
export async function requireEditAccess(
  user: SessionUser,
  target: ScopeTarget,
  visitLabel?: string | null,
): Promise<string | null> {
  const access = await resolveEditAccess(user, target);

  if (access.allowed) return access.grantId;

  const label = scopeLabel(target.scope, visitLabel);

  throw forbidden(
    access.pendingRequestId
      ? `Your request to edit the ${label} is still awaiting an administrator's decision.`
      : `The ${label} have already been submitted. Request approval from an administrator before editing.`,
  );
}

/**
 * Closes the approval that authorized a save. Safe to call with null, and safe
 * to call twice — the database only consumes a grant that is still APPROVED.
 */
export async function consumeEditGrant(
  grantId: string | null,
  actorId: string,
): Promise<void> {
  if (!grantId) return;

  const admin = createSupabaseAdminClient();
  await admin.rpc("consume_edit_grant", { p_request_id: grantId, p_actor: actorId });
}
