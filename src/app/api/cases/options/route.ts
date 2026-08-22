import { jsonOk, withApiErrors } from "@/lib/api/route";
import { requireUser } from "@/server/auth/session";
import { listMasterValues } from "@/server/services/master-data";

/** Filter options are independent of the result page and cached separately. */
export const GET = withApiErrors(async () => {
  await requireUser();

  const [procedures, procedureTypes, tags] = await Promise.all([
    listMasterValues({ table: "procedures" }),
    listMasterValues({ table: "procedure_types" }),
    listMasterValues({ table: "clinical_tags" }),
  ]);

  return jsonOk({ procedures, procedureTypes, tags });
});
