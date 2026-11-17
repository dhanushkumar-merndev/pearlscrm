import { z } from "zod";

import { jsonOk, withApiErrors } from "@/lib/api/route";
import { serverEnv } from "@/lib/env/server";
import { forbidden } from "@/lib/errors";
import { secretMatches } from "@/lib/push/fcm";
import { deliverNotificationPush } from "@/server/services/push";

/**
 * Called by Postgres only (trigger on public.notifications → pg_net), right
 * after a notification is saved. Authenticated by the shared secret held in
 * Supabase Vault (`push_dispatch_secret`) and PUSH_DISPATCH_SECRET here — not
 * by a user session, which this request never has.
 */

const bodySchema = z.object({ id: z.string().uuid() }).strict();

export const POST = withApiErrors(async (request: Request) => {
  const ok = await secretMatches(request.headers.get("x-push-secret"), serverEnv().PUSH_DISPATCH_SECRET);
  if (!ok) throw forbidden("Not allowed.");

  const { id } = bodySchema.parse(await request.json().catch(() => ({})));
  return jsonOk(await deliverNotificationPush(id));
});
