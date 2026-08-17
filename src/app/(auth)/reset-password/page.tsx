import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Set a new password" };

/**
 * Reached from an emailed recovery link (or a first-time invite). The Supabase
 * recovery session is established by `/auth/callback` before this renders.
 */
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
