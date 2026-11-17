import "server-only";

import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { forbidden, unauthenticated } from "@/lib/errors";
import { can, type Permission } from "@/lib/permissions";
import type { RoleCode } from "@/lib/types";

export type SessionUser = {
  id: string;
  email: string | null;
  displayName: string;
  role: RoleCode;
  isActive: boolean;
  /** Server-only storage reference; never passed to a Client Component. */
  avatarObjectKey: string | null;
};

type ProfileJoin = {
  id: string;
  display_name: string;
  is_active: boolean;
  avatar_object_key: string | null;
  roles: { code: RoleCode } | null;
};

/**
 * The authenticated user plus their profile/role, or null.
 *
 * Uses `getClaims()`, which verifies the access token's signature against the
 * project's asymmetric signing keys (cached JWKS) — never trusting an
 * unverified cookie like `getSession()` would — without a network round trip
 * to Supabase Auth on every request. Disabling an account still takes effect
 * immediately: `profiles.is_active` is read from the database every time.
 *
 * De-duplicated per request via `cache` so a page rendering several server
 * components pays for one round trip.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) return null;

  const user = { id: claims.sub, email: typeof claims.email === "string" && claims.email ? claims.email : undefined };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, is_active, avatar_object_key, roles(code)")
    .eq("id", user.id)
    .maybeSingle<ProfileJoin>();

  if (!profile?.roles) return null;

  return {
    id: user.id,
    email: user.email ?? null,
    displayName: profile.display_name || (user.email ?? "User"),
    role: profile.roles.code,
    isActive: profile.is_active,
    avatarObjectKey: profile.avatar_object_key,
  };
});

/**
 * Throws unless there is an authenticated, *active* user.
 *
 * A disabled account is rejected here even when its session cookie is still
 * technically valid, so revoking access takes effect on the next request.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();

  if (!user) throw unauthenticated();
  if (!user.isActive) {
    throw forbidden("This account has been disabled. Contact an administrator.");
  }

  return user;
}

/** Throws unless the active user holds `permission`. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();

  if (!can(user.role, permission)) throw forbidden();

  return user;
}
