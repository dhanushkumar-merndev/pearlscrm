"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, notFound, validationFailed } from "@/lib/errors";
import { createUserSchema, updateUserSchema } from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission } from "@/server/auth/session";
import { enforceWriteRateLimit } from "@/lib/rate-limit";
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
    await enforceWriteRateLimit("userAccessChange", actor.id);

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
    await enforceWriteRateLimit("userAccessChange", actor.id);

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

export type UserListResult = {
  rows: ProfileWithRole[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

const USER_PAGE_SIZE = 50;

/**
 * One page of accounts, newest-name-first, with the total so the table can say
 * how many there are rather than silently showing whatever the database
 * happened to return.
 *
 * Email and last sign-in live in `auth.users`, reachable only through the admin
 * API, so they are fetched for exactly the ids on this page.
 */
export async function listUsers(
  options: { page?: number; pageSize?: number } = {},
): Promise<UserListResult> {
  await requirePermission("user:manage");

  const pageSize = Math.min(Math.max(options.pageSize ?? USER_PAGE_SIZE, 1), 200);
  const page = Math.max(options.page ?? 1, 1);
  const from = (page - 1) * pageSize;

  const supabase = await createSupabaseServerClient();

  const { data: profiles, count } = await supabase
    .from("profiles")
    .select(
      "id, display_name, role_id, is_active, case_visibility_scope, created_at, updated_at, roles(code, name)",
      { count: "exact" },
    )
    .order("display_name", { ascending: true })
    .range(from, from + pageSize - 1)
    .returns<
      (ProfileWithRole & { roles: { code: RoleCode; name: string } | null })[]
    >();

  const rows = profiles ?? [];
  const authById = await lookupAuthUsers(rows.map((row) => row.id));
  const total = count ?? rows.length;

  return {
    rows: rows.map((row) => ({
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
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Every account as `{ id, name }`, for filter dropdowns.
 *
 * Deliberately separate from `listUsers`: a filter needs the whole set but none
 * of the auth-side detail, so this stays a single cheap query and never touches
 * the Supabase admin API.
 */
export async function listUserOptions(): Promise<{ id: string; name: string }[]> {
  await requirePermission("user:manage");

  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("profiles")
    .select("id, display_name")
    .order("display_name", { ascending: true })
    .limit(1000)
    .returns<{ id: string; display_name: string }[]>();

  return (data ?? []).map((row) => ({ id: row.id, name: row.display_name }));
}

/**
 * Emails and last sign-in for a specific set of ids.
 *
 * The admin API only pages, so a large directory is walked until every id on
 * the page has been seen — bounded by a page cap so a pathological directory
 * cannot turn one screen into an unbounded crawl.
 */
async function lookupAuthUsers(
  ids: string[],
): Promise<Map<string, { email: string | null; lastSignInAt: string | null }>> {
  const wanted = new Set(ids);
  const found = new Map<string, { email: string | null; lastSignInAt: string | null }>();
  if (wanted.size === 0) return found;

  const admin = createSupabaseAdminClient();
  const perPage = 200;
  const maxPages = 25;

  for (let page = 1; page <= maxPages && found.size < wanted.size; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) break;

    const users = data?.users ?? [];

    for (const user of users) {
      if (!wanted.has(user.id)) continue;
      found.set(user.id, {
        email: user.email ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
      });
    }

    if (users.length < perPage) break;
  }

  return found;
}
