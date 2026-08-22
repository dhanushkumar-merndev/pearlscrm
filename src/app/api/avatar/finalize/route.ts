import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";

import { jsonOk, readJson, withApiErrors } from "@/lib/api/route";
import { finalizeAvatarUploadSchema } from "@/lib/validation/schemas";
import { requireUser } from "@/server/auth/session";
import { finalizeAvatarUpload } from "@/server/services/avatar";

/** POST /api/avatar/finalize — confirms the private object and updates the profile atomically. */
export const POST = withApiErrors(async (request: NextRequest) => {
  const user = await requireUser();
  const body = finalizeAvatarUploadSchema.parse(await readJson(request));
  const result = await finalizeAvatarUpload({ user, ...body });

  revalidatePath("/profile");
  return jsonOk(result);
});
