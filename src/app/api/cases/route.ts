import type { NextRequest } from "next/server";

import { jsonOk, withApiErrors } from "@/lib/api/route";
import { caseListQuerySchema } from "@/lib/validation/schemas";
import { requireUser } from "@/server/auth/session";
import { listCases } from "@/server/queries/cases";

/** One authorized, server-filtered page of cases for the client cache. */
export const GET = withApiErrors(async (request: NextRequest) => {
  const user = await requireUser();
  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = caseListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : caseListQuerySchema.parse({});
  const result = await listCases(query, { includeCreator: user.role === "ADMIN" });

  return jsonOk({ result, query, showCreator: user.role === "ADMIN" });
});
