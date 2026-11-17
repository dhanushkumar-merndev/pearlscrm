import type { NextRequest } from "next/server";
import { z } from "zod";

import { jsonOk, withApiErrors } from "@/lib/api/route";
import { requirePermission } from "@/server/auth/session";
import { getDocumentReadUrl } from "@/server/services/documents";

/** GET /api/documents/:documentId/url — fresh short-lived presigned GET; never cached. */
export const GET = withApiErrors(
  async (_request: NextRequest, context: { params: Promise<{ documentId: string }> }) => {
    const user = await requirePermission("patient:read");
    const { documentId } = await context.params;
    const id = z.string().uuid().parse(documentId);
    return jsonOk(await getDocumentReadUrl({ user, documentId: id }));
  },
);
