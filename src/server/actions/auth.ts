"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
} from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { actionResult, type ActionResult } from "@/server/actions/result";

/**
 * Authentication actions.
 *
 * There is no sign-up action anywhere in this application by design — accounts
 * are created by administrators only (see `server/actions/users`).
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

export async function requestPasswordReset(
  input: ActionInput<typeof forgotPasswordSchema>,
): Promise<ActionResult<{ sent: true }>> {
  return actionResult(async () => {
    const data = forgotPasswordSchema.parse(input);
    const supabase = await createSupabaseServerClient();

    const origin = await siteOrigin();

    await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });

    // Always reports success: whether an address is registered is not something
    // an unauthenticated caller should be able to discover.
    return { sent: true as const };
  });
}

export async function completePasswordReset(
  input: ActionInput<typeof resetPasswordSchema>,
): Promise<ActionResult<{ updated: true }>> {
  return actionResult(async () => {
    const data = resetPasswordSchema.parse(input);
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new AppError(
        "UNAUTHENTICATED",
        "This password reset link has expired. Request a new one.",
      );
    }

    const { error } = await supabase.auth.updateUser({ password: data.password });

    if (error) throw new AppError("VALIDATION", "That password could not be set. Try another.");

    return { updated: true as const };
  });
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}

async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return `${protocol}://${host}`;
}
