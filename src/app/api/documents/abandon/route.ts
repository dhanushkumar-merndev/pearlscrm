import type { NextRequest } from "next/server";
import { z } from "zod";

import { jsonOk, readJson, withApiErrors } from "@/lib/api/route";
import { requirePermission } from "@/server/auth/session";
import { abandonDocumentUpload } from "@/server/services/documents";

const schema = z.object({ uploadSessionId: z.string().uuid() });

/** POST /api/documents/abandon — release an unfinished upload and its orphan object. */
export const POST = withApiErrors(async (request: NextRequest) => {
  const user = await requirePermission("prescription:upload");
  const body = schema.parse(await readJson(request));
  await abandonDocumentUpload({ user, uploadSessionId: body.uploadSessionId });
  return jsonOk({ abandoned: true });
});
