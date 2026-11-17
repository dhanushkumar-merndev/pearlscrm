import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";

import { jsonOk, readJson, withApiErrors } from "@/lib/api/route";
import { logServerError } from "@/lib/errors";
import { finalizeDocumentUploadSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/server/auth/session";
import { finalizeDocumentUpload } from "@/server/services/documents";

/** POST /api/documents/finalize — confirm the object, record it once (idempotent). */
export const POST = withApiErrors(async (request: NextRequest) => {
  const user = await requirePermission("prescription:upload");
  const body = finalizeDocumentUploadSchema.parse(await readJson(request));

  const document = await finalizeDocumentUpload({
    user,
    uploadSessionId: body.uploadSessionId,
    sha256: body.sha256,
  });

  try {
    revalidatePath(`/patients/${document.patient_id}`);
  } catch (cause) {
    logServerError(cause, `document-finalize:revalidate:${body.uploadSessionId}`);
  }

  return jsonOk(document);
});
