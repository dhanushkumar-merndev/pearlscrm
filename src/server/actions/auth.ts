"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors";
import { signInSchema } from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { actionResult, type ActionResult } from "@/server/actions/result";

/**
 * Authentication actions.
 *
 * There is no sign-up action anywhere in this application by design — accounts
 * are created by administrators only (see `server/actions/users`), and there
 * is no self-service password reset: an administrator sets each account's
 * password when the account is created.
 */

export async function signIn(
  input: ActionInput<typeof signInSchema>,
): Promise<ActionResult<{ signedIn: true }>> {
  return actionResult(async () => {
    const data = signInSchema.parse(input);
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      // Deliberately identical for "no such user" and "wrong password" so the
      // form cannot be used to enumerate which accounts exist.
      throw new AppError("UNAUTHENTICATED", "Incorrect email address or password.");
    }

    // A disabled profile must not be able to reach the application, even with
    // valid credentials.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_active")
        .eq("id", user.id)
        .maybeSingle<{ is_active: boolean }>();

      if (!profile?.is_active) {
        await supabase.auth.signOut();
        throw new AppError(
          "FORBIDDEN",
          "This account has been disabled. Contact an administrator.",
        );
      }
    }

    return { signedIn: true as const };
  });
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
