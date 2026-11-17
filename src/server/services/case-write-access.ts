import "server-only";

import { forbidden } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Write gate for any server path that checks a case through the user's own
 * session and then writes with the service role.
 *
 * Since 0032 a DOCTOR can *read* every treatment that belongs to a patient
 * (the cross-branch File ID history), so "the session can see this case" no
 * longer means "this user may change it". This asks the database the real
 * question — `case_is_writable`, which is assignment-based and identical to
 * the pre-0032 rule — as the signed-in user.
 */
export async function requireCaseWriteAccess(caseId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("case_is_writable", { p_case_id: caseId });

  if (error || data !== true) {
    throw forbidden(
      "You can view this treatment but not change it. Ask an administrator to assign you to it.",
    );
  }
}
