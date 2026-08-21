"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env/public";
import { AppError, validationFailed } from "@/lib/errors";
import { changeOwnPasswordSchema, updateOwnProfileSchema } from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requireUser } from "@/server/auth/session";
import { recordAudit } from "@/server/services/audit";
import { actionResult, type ActionResult } from "@/server/actions/result";

/**
 * A user's own account.
 *
 * Deliberately narrow: a person may change their display name and their
 * password, nothing else. Role and active status are administered elsewhere and
 * are not writable from here — migration 0011 revokes column privileges so the
 * database refuses those columns even if this code were wrong.
 */

export async function updateOwnProfile(
  input: ActionInput<typeof updateOwnProfileSchema>,
): Promise<ActionResult<{ displayName: string }>> {
  return actionResult(async () => {
    const user = await requireUser();
    const data = updateOwnProfileSchema.parse(input);

    // The user's own client, so RLS (`profiles_update_self`) and the column
    // grants from 0011 both apply — this cannot touch role or is_active.
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase
      .from("profiles")
      .update({ display_name: data.displayName })
      .eq("id", user.id);

    if (error) throw new AppError("INTERNAL", "Your profile could not be updated.");

    await recordAudit({
      actorUserId: user.id,
      action: "PROFILE_UPDATED",
      entityType: "profile",
      entityId: user.id,
      metadata: { changed_fields: ["display_name"] },
    });

    revalidatePath("/profile");

    return { displayName: data.displayName };
  });
}

export async function changeOwnPassword(
  input: ActionInput<typeof changeOwnPasswordSchema>,
): Promise<ActionResult<{ changed: true }>> {
  return actionResult(async () => {
    const user = await requireUser();
    const data = changeOwnPasswordSchema.parse(input);

    if (!user.email) {
      throw validationFailed("This account has no email address to verify against.");
    }

    // Re-authenticate before allowing the change. Without this, anyone who got
    // hold of a live session could lock the real owner out of their account.
    //
    // Verified on a throwaway client that persists nothing, so confirming the
    // password cannot disturb the cookies of the session making the request.
    const env = publicEnv();
    const verifier = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: verifyError } = await verifier.auth.signInWithPassword({
      email: user.email,
      password: data.currentPassword,
    });

    if (verifyError) {
      throw validationFailed("Your current password is not correct.", {
        currentPassword: ["That is not your current password."],
      });
    }

    await verifier.auth.signOut();

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.updateUser({ password: data.newPassword });

    if (error) throw new AppError("INTERNAL", "Your password could not be changed.");

    await recordAudit({
      actorUserId: user.id,
      action: "PASSWORD_CHANGED",
      entityType: "profile",
      entityId: user.id,
      // Never record anything about the password itself, old or new.
      metadata: {},
    });

    return { changed: true as const };
  });
}
