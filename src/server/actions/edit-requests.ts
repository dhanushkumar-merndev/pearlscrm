"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, conflict, forbidden, notFound, validationFailed } from "@/lib/errors";
import {
  cancelEditRequestSchema,
  decideEditRequestSchema,
  editAccessQuerySchema,
  grantableScopesQuerySchema,
  requestCaseEditSchema,
} from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission, requireUser } from "@/server/auth/session";
import { enforceWriteRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/server/services/audit";
import { resolveEditAccess, scopeLabel, type ScopeTarget } from "@/server/services/edit-access";
import { actionResult, type ActionResult } from "@/server/actions/result";
import type { CaseEditRequest, CaseVisit, EditAccess, GrantableScope } from "@/lib/types";

/**
 * The admin edit-approval workflow.
 *
 * A submitted scope reopens only after an administrator approves a written
 * request naming the reason. Creating the request, notifying the administrators
 * and auditing it happen inside one database function so a request can never
 * exist unannounced; the same is true of the decision.
 */

function targetFor(input: {
  caseId: string;
  scope: "CASE_INFORMATION" | "CASE_NOTES" | "VISIT_DETAILS" | "VISIT_IMAGES";
  visitId?: string;
}): ScopeTarget {
  return input.scope === "CASE_INFORMATION" || input.scope === "CASE_NOTES"
    ? { scope: input.scope, caseId: input.caseId }
    : { scope: input.scope, caseId: input.caseId, visitId: input.visitId! };
}

/** What the current user may do with one scope. Read-only; used by the UI. */
export async function getEditAccess(
  input: ActionInput<typeof editAccessQuerySchema>,
): Promise<ActionResult<EditAccess>> {
  return actionResult(async () => {
    const user = await requireUser();
    const data = editAccessQuerySchema.parse(input);

    return resolveEditAccess(user, targetFor(data));
  });
}

export async function requestCaseEdit(
  input: ActionInput<typeof requestCaseEditSchema>,
): Promise<ActionResult<{ requestId: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("edit_request:create");
    const data = requestCaseEditSchema.parse(input);

    const target = targetFor(data);
    const access = await resolveEditAccess(user, target);

    // Nothing to ask for: the scope has never been submitted, or the user is an
    // administrator and is their own approver.
    if (!access.locked || user.role === "ADMIN") {
      throw validationFailed(
        `The ${scopeLabel(data.scope)} can be edited without approval.`,
      );
    }

    if (access.grantId) {
      throw conflict("An approved edit is already open for this section.");
    }

    if (access.pendingRequestId) {
      throw conflict("A request for this section is already awaiting a decision.");
    }

    const admin = createSupabaseAdminClient();

    const { data: created, error } = await admin
      .rpc("create_edit_request", {
        p_case_id: data.caseId,
        p_scope: data.scope,
        p_visit_id: data.visitId ?? null,
        p_reason: data.reason,
        p_actor: user.id,
      })
      .single<CaseEditRequest>();

    if (error || !created) {
      // The partial unique index is the real guard against a double submit.
      if (error?.code === "23505") {
        throw conflict("A request for this section is already awaiting a decision.");
      }
      throw new AppError("INTERNAL", "The approval request could not be sent.");
    }

    revalidatePath(`/cases/${data.caseId}`);
    revalidatePath("/approvals");

    return { requestId: created.id };
  });
}

/**
 * Every section of a case that can be handed over, with this user's standing
 * against each. Drives the checkboxes on the approval dialog: the section that
 * was asked for is selected automatically, and the administrator can open
 * neighbouring ones in the same decision.
 */
export async function getGrantableScopes(
  input: ActionInput<typeof grantableScopesQuerySchema>,
): Promise<ActionResult<GrantableScope[]>> {
  return actionResult(async () => {
    await requirePermission("edit_request:decide");
    const data = grantableScopesQuerySchema.parse(input);

    const supabase = await createSupabaseServerClient();

    const [caseRes, notesRes, visitsRes, openRes] = await Promise.all([
      supabase
        .from("cases")
        .select("id, information_locked_at")
        .eq("id", data.caseId)
        .maybeSingle<{ id: string; information_locked_at: string | null }>(),
      supabase
        .from("case_notes")
        .select("locked_at")
        .eq("case_id", data.caseId)
        .maybeSingle<{ locked_at: string | null }>(),
      supabase
        .from("case_visits")
        .select("*")
        .eq("case_id", data.caseId)
        .returns<CaseVisit[]>(),
      supabase
        .from("case_edit_requests")
        .select("scope, visit_id")
        .eq("case_id", data.caseId)
        .eq("requested_by", data.userId)
        .in("status", ["PENDING", "APPROVED"])
        .returns<{ scope: GrantableScope["scope"]; visit_id: string | null }[]>(),
    ]);

    if (!caseRes.data) throw notFound("This case could not be found.");

    const open = new Set(
      (openRes.data ?? []).map((row) => `${row.scope}:${row.visit_id ?? ""}`),
    );

    const entry = (
      scope: GrantableScope["scope"],
      visitId: string | null,
      label: string,
      locked: boolean,
    ): GrantableScope => {
      const key = `${scope}:${visitId ?? ""}`;
      return { key, scope, visitId, label, locked, alreadyOpen: open.has(key) };
    };

    const visits = visitsRes.data ?? [];
    const phase = (type: CaseVisit["visit_type"]) =>
      visits.find((visit) => visit.visit_type === type) ?? null;

    const scopes: GrantableScope[] = [
      entry(
        "CASE_INFORMATION",
        null,
        "Case information",
        caseRes.data.information_locked_at !== null,
      ),
      entry("CASE_NOTES", null, "Case notes", notesRes.data?.locked_at !== null),
    ];

    for (const type of ["BEFORE", "AFTER"] as const) {
      const visit = phase(type);
      if (!visit) continue;
      scopes.push(
        entry(
          "VISIT_IMAGES",
          visit.id,
          `${visit.display_label} images`,
          visit.images_locked_at !== null,
        ),
      );
    }

    const followups = visits
      .filter((visit) => visit.visit_type === "FOLLOW_UP")
      .sort((a, b) => (a.visit_date ?? "").localeCompare(b.visit_date ?? ""));

    for (const visit of followups) {
      scopes.push(
        entry(
          "VISIT_IMAGES",
          visit.id,
          `${visit.display_label} images`,
          visit.images_locked_at !== null,
        ),
        entry(
          "VISIT_DETAILS",
          visit.id,
          `${visit.display_label} details`,
          visit.details_locked_at !== null,
        ),
      );
    }

    return scopes;
  });
}

export async function decideEditRequest(
  input: ActionInput<typeof decideEditRequestSchema>,
): Promise<ActionResult<{ requestId: string; status: string }>> {
  return actionResult(async () => {
    const user = await requirePermission("edit_request:decide");
    const data = decideEditRequestSchema.parse(input);
    await enforceWriteRateLimit("userAccessChange", user.id);

    const admin = createSupabaseAdminClient();

    const { data: decided, error } = await admin
      .rpc("decide_edit_request", {
        p_request_id: data.requestId,
        p_approve: data.approve,
        p_note: data.note,
        p_ttl_hours: data.ttlHours,
        p_actor: user.id,
      })
      .single<CaseEditRequest>();

    if (error || !decided) {
      if (error?.code === "22023") {
        throw conflict("This request has already been decided.");
      }
      if (error?.code === "P0002") {
        throw notFound("This request could not be found.");
      }
      throw new AppError("INTERNAL", "The decision could not be recorded.");
    }

    // An approval can hand over neighbouring sections in the same decision. Each
    // becomes its own single-use grant, spent by its own save; a section the
    // requester already holds is skipped rather than duplicated.
    if (data.approve) {
      for (const extra of data.additionalScopes) {
        const sameAsRequest =
          extra.scope === decided.scope && extra.visitId === decided.visit_id;

        if (sameAsRequest) continue;

        await admin.rpc("grant_edit_access", {
          p_case_id: decided.case_id,
          p_scope: extra.scope,
          p_visit_id: extra.visitId,
          p_user: decided.requested_by,
          p_reason: `Opened alongside the approved request: ${decided.reason}`,
          p_ttl_hours: data.ttlHours,
          p_actor: user.id,
        });
      }
    }

    revalidatePath("/approvals");
    revalidatePath(`/cases/${decided.case_id}`);

    return { requestId: decided.id, status: decided.status };
  });
}

/** A requester withdrawing their own request before it has been decided. */
export async function cancelEditRequest(
  input: ActionInput<typeof cancelEditRequestSchema>,
): Promise<ActionResult<{ cancelled: true }>> {
  return actionResult(async () => {
    const user = await requireUser();
    const data = cancelEditRequestSchema.parse(input);

    const supabase = await createSupabaseServerClient();

    const { data: existing } = await supabase
      .from("case_edit_requests")
      .select("*")
      .eq("id", data.requestId)
      .maybeSingle<CaseEditRequest>();

    if (!existing) throw notFound("This request could not be found.");
    if (existing.requested_by !== user.id) {
      throw forbidden("Only the person who raised a request can withdraw it.");
    }
    if (existing.status !== "PENDING") {
      throw conflict("This request has already been decided.");
    }

    const { data: cancelled, error } = await supabase
      .from("case_edit_requests")
      .update({ status: "CANCELLED" })
      .eq("id", data.requestId)
      .eq("status", "PENDING")
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) throw new AppError("INTERNAL", "The request could not be withdrawn.");
    if (!cancelled) throw conflict("This request has already been decided.");

    await recordAudit({
      actorUserId: user.id,
      action: "EDIT_REQUEST_CANCELLED",
      entityType: "case_edit_request",
      entityId: data.requestId,
      caseId: existing.case_id,
      metadata: { scope: existing.scope, visit_id: existing.visit_id },
    });

    revalidatePath(`/cases/${existing.case_id}`);
    revalidatePath("/approvals");

    return { cancelled: true as const };
  });
}
