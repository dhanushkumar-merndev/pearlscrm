import type { NextRequest } from "next/server";

import { jsonOk, readJson, withApiErrors } from "@/lib/api/route";
import { abandonUploadSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/server/auth/session";
import { abandonUpload } from "@/server/services/images";

/**
 * POST /api/uploads/abandon
 *
 * Releases an upload the browser gave up on and removes the orphaned object.
 * A finalized clinical original is never touched by this path.
 */
export const POST = withApiErrors(async (request: NextRequest) => {
  const user = await requirePermission("image:upload");
  const body = abandonUploadSchema.parse(await readJson(request));

  await abandonUpload({ user, uploadSessionId: body.uploadSessionId });

  return jsonOk({ abandoned: true });
});
