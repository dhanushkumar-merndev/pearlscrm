import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";

import { jsonOk, readJson, withApiErrors } from "@/lib/api/route";
import { logServerError } from "@/lib/errors";
import { finalizeUploadSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/server/auth/session";
import { finalizeUpload } from "@/server/services/images";

/**
 * POST /api/uploads/finalize
 *
 * Confirms the object landed, records the immutable version row, repoints the
 * slot and audits — atomically, and idempotently on the upload session.
 */
export const POST = withApiErrors(async (request: NextRequest) => {
  const user = await requirePermission("image:upload");
  const body = finalizeUploadSchema.parse(await readJson(request));

  const version = await finalizeUpload({
    user,
    uploadSessionId: body.uploadSessionId,
    sha256: body.sha256,
  });

  // The version row is already committed by this point. A failure to refresh a
  // cache must not turn a successful upload into a 500 the client retries.
  try {
    revalidatePath("/cases");
  } catch (cause) {
    logServerError(cause, `finalize:revalidate:${body.uploadSessionId}`);
  }

  // Object keys stay server-side; the client gets only what it needs to render.
  return jsonOk({
    versionId: version.id,
    clinicalImageId: version.clinical_image_id,
    mimeType: version.mime_type,
    fileSize: version.file_size,
    uploadedAt: version.uploaded_at,
  });
});
