"use server";

import { revalidatePath } from "next/cache";

import { AppError, notFound } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ActionInput } from "@/lib/validation/action-input";
import {
  branchSchema,
  procedureNumberingSchema,
  setUserBranchSchema,
  updateBranchSchema,
} from "@/lib/validation/schemas";
import type { Branch } from "@/lib/types";
import { requirePermission } from "@/server/auth/session";
import { actionResult, type ActionResult } from "@/server/actions/result";
import { recordAudit } from "@/server/services/audit";
import { rpcError } from "@/server/services/rpc-errors";

/**
 * Administrator settings for branches, users' home branches and per-procedure
 * case numbering. Branches are never deleted — a disabled branch stops being
 * offered but its File IDs stay valid. A code already printed on File IDs is
 * frozen by a database trigger.
 */

export async function createBranch(input: ActionInput<typeof branchSchema>): Promise<ActionResult<Branch>> {
  return actionResult(async () => {
    const user = await requirePermission("branch:manage");
    const data = branchSchema.parse(input);
    const admin = createSupabaseAdminClient();

    const { data: row, error } = await admin
      .from("branches")
      .insert({ code: data.code, name: data.name })
      .select("*")
      .single<Branch>();
    if (error || !row) throw rpcError(error, "The branch could not be created.");

    await recordAudit({
      actorUserId: user.id,
      action: "BRANCH_CREATED",
      entityType: "branch",
      entityId: row.id,
      metadata: { code: row.code, name: row.name },
    });
    revalidatePath("/settings");
    return row;
  });
}

export async function updateBranch(input: ActionInput<typeof updateBranchSchema>): Promise<ActionResult<Branch>> {
  return actionResult(async () => {
    const user = await requirePermission("branch:manage");
    const data = updateBranchSchema.parse(input);
    const admin = createSupabaseAdminClient();

    const { data: before } = await admin.from("branches").select("*").eq("id", data.branchId).maybeSingle<Branch>();
    if (!before) throw notFound("That branch could not be found.");

    const { data: row, error } = await admin
      .from("branches")
      .update({ code: data.code, name: data.name, is_active: data.isActive })
      .eq("id", data.branchId)
      .select("*")
      .single<Branch>();
    if (error || !row) throw rpcError(error, "The branch could not be updated.");

    const changed = (["code", "name", "is_active"] as const).filter((key) => before[key] !== row[key]);
    if (changed.length) {
      await recordAudit({
        actorUserId: user.id,
        action: "BRANCH_UPDATED",
        entityType: "branch",
        entityId: row.id,
        metadata: {
          changed_fields: changed,
          before: Object.fromEntries(changed.map((k) => [k, before[k]])),
          after: Object.fromEntries(changed.map((k) => [k, row[k]])),
        },
      });
    }
    revalidatePath("/settings");
    return row;
  });
}

export async function setUserBranch(
  input: ActionInput<typeof setUserBranchSchema>,
): Promise<ActionResult<{ userId: string; branchId: string | null }>> {
  return actionResult(async () => {
    const actor = await requirePermission("user:manage");
    const data = setUserBranchSchema.parse(input);
    const admin = createSupabaseAdminClient();

    if (data.branchId) {
      const { data: branch } = await admin.from("branches").select("id, is_active").eq("id", data.branchId).maybeSingle<{ id: string; is_active: boolean }>();
      if (!branch?.is_active) throw notFound("That branch is not available.");
    }

    const { data: row, error } = await admin
      .from("profiles")
      .update({ branch_id: data.branchId })
      .eq("id", data.userId)
      .select("id, branch_id")
      .maybeSingle<{ id: string; branch_id: string | null }>();
    if (error) throw new AppError("INTERNAL", "The branch could not be saved.");
    if (!row) throw notFound("That user could not be found.");

    await recordAudit({
      actorUserId: actor.id,
      action: "USER_BRANCH_UPDATED",
      entityType: "profile",
      entityId: row.id,
      metadata: { branch_id: row.branch_id },
    });
    revalidatePath("/users");
    return { userId: row.id, branchId: row.branch_id };
  });
}

export type ProcedureNumbering = {
  id: string;
  display_name: string;
  case_prefix: string | null;
  default_mode: "SURGICAL" | "SESSIONS" | null;
  is_active: boolean;
};

export async function setProcedureNumbering(
  input: ActionInput<typeof procedureNumberingSchema>,
): Promise<ActionResult<ProcedureNumbering>> {
  return actionResult(async () => {
    const user = await requirePermission("master_data:manage");
    const data = procedureNumberingSchema.parse(input);
    const admin = createSupabaseAdminClient();

    const { data: row, error } = await admin
      .from("procedures")
      .update({ case_prefix: data.casePrefix, default_mode: data.defaultMode })
      .eq("id", data.procedureId)
      .select("id, display_name, case_prefix, default_mode, is_active")
      .maybeSingle<ProcedureNumbering>();
    if (error) throw rpcError(error, "The numbering could not be saved.");
    if (!row) throw notFound("That procedure could not be found.");

    await recordAudit({
      actorUserId: user.id,
      action: "PROCEDURE_NUMBERING_UPDATED",
      entityType: "procedure",
      entityId: row.id,
      metadata: { case_prefix: row.case_prefix, default_mode: row.default_mode },
    });
    revalidatePath("/settings");
    return row;
  });
}
