"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, notFound, validationFailed } from "@/lib/errors";
import { createUserSchema, updateUserSchema } from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission } from "@/server/auth/session";
import { recordAudit } from "@/server/services/audit";
import { actionResult, type ActionResult } from "@/server/actions/result";
import type { ProfileWithRole, RoleCode } from "@/lib/types";

/**
 * User administration.
 *
 * There is no public sign-up anywhere in the application: accounts exist only
 * because an administrator created them, and the administrator sets each
 * account's initial password at creation time (there is no self-service
 * password reset or email invitation flow). Supabase Auth admin APIs are called
 * exclusively from here, server-side, behind an ADMIN permission check.
 */

export async function createUser(
  input: ActionInput<typeof createUserSchema>,
): Promise<ActionResult<{ userId: string }>> {
  return actionResult(async () => {
    const actor = await requirePermission("user:manage");
    const data = createUserSchema.parse(input);

    const admin = createSupabaseAdminClient();
    const roleId = await roleIdForCode(data.roleCode);

    const { data: created, error } = await admin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { display_name: data.displayName },
    });

    if (error || !created.user) {
      if (error?.message?.toLowerCase().includes("already been registered")) {
        throw validationFailed("An account already exists for that email address.", {
          email: ["This email address is already registered."],
        });
      }
      throw new AppError("INTERNAL", "The account could not be created.");
    }

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: created.user.id,
        display_name: data.displayName,
        role_id: roleId,
        is_active: true,
        // Doctors and newly created viewers start with least-privilege case
        // visibility. Doctors gain cases by creating them or by assignment.
        case_visibility_scope: data.roleCode === "ADMIN" ? "ALL" : "SELECTED",
      },
      { onConflict: "id" },
    );

    if (profileError) throw new AppError("INTERNAL", "The user profile could not be created.");

    await recordAudit({
      actorUserId: actor.id,
      action: "USER_CREATED",
      entityType: "profile",
      entityId: created.user.id,
      // The address is the identifier here and is not clinical data.
      metadata: { role: data.roleCode, display_name: data.displayName },
    });

    revalidatePath("/users");

    return { userId: created.user.id };
  });
}

export async function updateUser(
  input: ActionInput<typeof updateUserSchema>,
): Promise<ActionResult<{ userId: string }>> {
  return actionResult(async () => {
    const actor = await requirePermission("user:manage");
    const data = updateUserSchema.parse(input);

    // An administrator locking themselves out would leave the clinic without
    // any way back in.
    if (data.userId === actor.id && data.isActive === false) {
      throw validationFailed("You cannot disable your own account.");
    }
    if (data.userId === actor.id && data.roleCode && data.roleCode !== "ADMIN") {
      throw validationFailed("You cannot remove your own administrator role.");
    }

    const admin = createSupabaseAdminClient();

    const { data: target } = await admin
      .from("profiles")
      .select("id, roles(code)")
      .eq("id", data.userId)
      .maybeSingle<{ id: string; roles: { code: RoleCode } | null }>();

    if (!target) throw notFound("That user could not be found.");

    const resultingRole = data.roleCode ?? target.roles?.code;
    if (data.caseVisibilityScope && resultingRole !== "VIEWER") {
      throw validationFailed("All/selected case visibility applies only to Viewer accounts.");
    }

    const update: Record<string, unknown> = {};
    if (data.displayName !== undefined) update.display_name = data.displayName;
    if (data.isActive !== undefined) update.is_active = data.isActive;
    if (data.roleCode) {
      update.role_id = await roleIdForCode(data.roleCode);
      update.case_visibility_scope = data.roleCode === "ADMIN" ? "ALL" : "SELECTED";
    }
    if (data.caseVisibilityScope) update.case_visibility_scope = data.caseVisibilityScope;

    if (Object.keys(update).length === 0) return { userId: data.userId };

    const { data: updated, error } = await admin
      .from("profiles")
      .update(update)
      .eq("id", data.userId)
      .select("id, is_active")
      .maybeSingle<{ id: string; is_active: boolean }>();

    if (error) throw new AppError("INTERNAL", "The user could not be updated.");
    if (!updated) throw notFound("That user could not be found.");

    if (data.isActive === false) {
      // Revoke live sessions so a disabled account loses access immediately
      // rather than at the next token refresh.
      await admin.auth.admin.signOut(data.userId, "global").catch(() => {});
    }

    await recordAudit({
      actorUserId: actor.id,
      action:
        data.isActive === false
          ? "USER_DISABLED"
          : data.isActive === true
            ? "USER_ENABLED"
            : "USER_UPDATED",
      entityType: "profile",
      entityId: data.userId,
      metadata: {
        ...(data.roleCode ? { role: data.roleCode } : {}),
        ...(data.caseVisibilityScope ? { case_visibility_scope: data.caseVisibilityScope } : {}),
        ...(data.isActive !== undefined ? { is_active: data.isActive } : {}),
        ...(data.displayName !== undefined ? { display_name_changed: true } : {}),
      },
    });

    revalidatePath("/users");

    return { userId: data.userId };
  });
}

async function roleIdForCode(code: RoleCode): Promise<string> {
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("roles")
    .select("id")
    .eq("code", code)
    .maybeSingle<{ id: string }>();

  if (!data) throw new AppError("INTERNAL", "That role is not configured.");

  return data.id;
}

export async function listUsers(): Promise<ProfileWithRole[]> {
  await requirePermission("user:manage");

  const supabase = await createSupabaseServerClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, role_id, is_active, case_visibility_scope, created_at, updated_at, roles(code, name)")
    .order("display_name", { ascending: true })
    .returns<
      (ProfileWithRole & { roles: { code: RoleCode; name: string } | null })[]
    >();

  const rows = profiles ?? [];

  // Email and last sign-in live in auth.users, reachable only via the admin API.
  const admin = createSupabaseAdminClient();
  const { data: authUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

  const authById = new Map(
    (authUsers?.users ?? []).map((user) => [
      user.id,
      { email: user.email ?? null, lastSignInAt: user.last_sign_in_at ?? null },
    ]),
  );

  return rows.map((row) => ({
    id: row.id,
    display_name: row.display_name,
    role_id: row.role_id,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    role_code: row.roles?.code ?? "VIEWER",
    role_name: row.roles?.name ?? "Viewer",
    case_visibility_scope: row.case_visibility_scope,
    email: authById.get(row.id)?.email ?? null,
    last_sign_in_at: authById.get(row.id)?.lastSignInAt ?? null,
  }));
}
