import type { NextRequest } from "next/server";

import { jsonOk, readJson, withApiErrors } from "@/lib/api/route";
import { authorizeDocumentUploadSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/server/auth/session";
import { authorizeDocumentUpload } from "@/server/services/documents";

/** POST /api/documents/authorize — short-lived presigned PUT for a prescription. */
export const POST = withApiErrors(async (request: NextRequest) => {
  const user = await requirePermission("prescription:upload");
  const body = authorizeDocumentUploadSchema.parse(await readJson(request));

  return jsonOk(
    await authorizeDocumentUpload({
      user,
      patientId: body.patientId,
      consultationId: body.consultationId,
      kind: body.kind,
      filename: body.filename,
      mimeType: body.mimeType,
      fileSize: body.fileSize,
    }),
  );
});
