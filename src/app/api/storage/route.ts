import { jsonOk, withApiErrors } from "@/lib/api/route";
import { getStorageUsage } from "@/server/queries/storage";

/**
 * Read-only storage usage. Administrator-gated inside `getStorageUsage`, and
 * never cached by a shared cache — `jsonOk` sets `no-store`.
 */
export const GET = withApiErrors(async () => {
  return jsonOk(await getStorageUsage());
});
