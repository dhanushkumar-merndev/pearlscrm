import type { NextRequest } from "next/server";

import { jsonOk, withApiErrors } from "@/lib/api/route";
import { imageReadUrlSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/server/auth/session";
import { getImageReadUrl } from "@/server/services/images";

/**
 * GET /api/images/:imageId/url
 *
 * Mints a fresh short-lived presigned GET. Nothing here is ever persisted or
 * cached: the response is `no-store`, and the URL expires within minutes.
 */
export const GET = withApiErrors(
  async (request: NextRequest, context: { params: Promise<{ imageId: string }> }) => {
    const user = await requirePermission("image:read");

    const { imageId } = await context.params;
    const search = request.nextUrl.searchParams;

    const params = imageReadUrlSchema.parse({
      imageId,
      versionId: search.get("versionId") ?? undefined,
      download: search.get("download") === "1",
    });

    const result = await getImageReadUrl({
      user,
      imageId: params.imageId,
      versionId: params.versionId,
      download: params.download,
    });

    return jsonOk(result);
  },
);
