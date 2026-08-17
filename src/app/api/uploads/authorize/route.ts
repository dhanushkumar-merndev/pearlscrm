import type { NextRequest } from "next/server";

import { jsonOk, readJson, withApiErrors } from "@/lib/api/route";
import { getUploadUrlSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/server/auth/session";
import { authorizeUpload } from "@/server/services/images";

/**
 * POST /api/uploads/authorize
 *
 * Returns a short-lived presigned Tigris PUT URL. Every relationship the client
 * asserted — case, visit, view, type, size — is re-validated server-side before
 * anything is signed.
 */
export const POST = withApiErrors(async (request: NextRequest) => {
  const user = await requirePermission("image:upload");
  const body = getUploadUrlSchema.parse(await readJson(request));

  const authorization = await authorizeUpload({
    user,
    caseId: body.caseId,
    visitId: body.visitId,
    viewTypeId: body.viewTypeId,
    filename: body.filename,
    mimeType: body.mimeType,
    fileSize: body.fileSize,
  });

  return jsonOk(authorization);
});
