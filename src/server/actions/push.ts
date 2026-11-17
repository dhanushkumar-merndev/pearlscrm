"use server";

import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/session";
import { actionResult, type ActionResult } from "@/server/actions/result";

/**
 * Browser push registration. Each browser the person enables gets one FCM
 * token; the database moves a token to whoever registers it last, so a shared
 * front-desk computer follows the person signed in.
 */

const tokenSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  userAgent: z.string().trim().max(200).optional(),
});

export async function registerPushToken(input: {
  token: string;
  userAgent?: string;
}): Promise<ActionResult<{ registered: true }>> {
  return actionResult(async () => {
    const user = await requireUser();
    const data = tokenSchema.parse(input);
    const admin = createSupabaseAdminClient();

    const { error } = await admin.rpc("register_push_token", {
      p_token: data.token,
      p_user_agent: data.userAgent ?? null,
      p_actor: user.id,
    });
    if (error) throw new Error("register_push_token failed");

    return { registered: true as const };
  });
}

/** Removes this browser's token. RLS lets a user delete only their own rows. */
export async function unregisterPushToken(input: {
  token: string;
}): Promise<ActionResult<{ removed: true }>> {
  return actionResult(async () => {
    await requireUser();
    const { token } = tokenSchema.pick({ token: true }).parse(input);
    const supabase = await createSupabaseServerClient();

    await supabase.from("push_tokens").delete().eq("token", token);

    return { removed: true as const };
  });
}
