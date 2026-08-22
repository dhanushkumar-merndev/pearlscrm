import type { NextRequest } from "next/server";

import { jsonOk, readJson, withApiErrors } from "@/lib/api/route";
import { enforceWriteRateLimit } from "@/lib/rate-limit";
import { authorizeAvatarUploadSchema } from "@/lib/validation/schemas";
import { requireUser } from "@/server/auth/session";
import { authorizeAvatarUpload } from "@/server/services/avatar";

/** POST /api/avatar/authorize — authorizes one direct private avatar upload. */
export const POST = withApiErrors(async (request: NextRequest) => {
  const user = await requireUser();
  const body = authorizeAvatarUploadSchema.parse(await readJson(request));

  // A profile photo is not a clinical image, but this still prevents a user
  // from minting an unlimited number of storage upload URLs.
  await enforceWriteRateLimit("userAccessChange", user.id);

  return jsonOk(await authorizeAvatarUpload({ user, ...body }));
});
