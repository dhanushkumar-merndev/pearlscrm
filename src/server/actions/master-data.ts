"use server";

import { revalidatePath } from "next/cache";

import {
  createMasterValueSchema,
  pageMasterValuesSchema,
  searchMasterValuesSchema,
  setMasterValueActiveSchema,
} from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission, requireUser } from "@/server/auth/session";
import {
  createMasterValue,
  pageMasterValues,
  searchMasterValues,
  setMasterValueActive,
  type MasterValuePage,
} from "@/server/services/master-data";
import { actionResult, type ActionResult } from "@/server/actions/result";
import type { MasterValue } from "@/lib/types";

/**
 * Backing actions for the self-learning type-or-select comboboxes.
 */

export async function searchMasterValuesAction(
  input: ActionInput<typeof searchMasterValuesSchema>,
): Promise<ActionResult<{ values: MasterValue[]; exactMatch: MasterValue | null }>> {
  return actionResult(async () => {
    await requireUser();
    const data = searchMasterValuesSchema.parse(input);

    return searchMasterValues({
      table: data.table,
      query: data.query,
      limit: data.limit,
      includeInactiveId: data.includeInactiveId,
    });
  });
}

/**
 * Creates a value from within the dropdown — the user never has to visit
 * Settings first. Returns `created: false` when the normalized key already
 * existed, so the caller can select the existing record instead.
 */
export async function createMasterValueAction(
  input: ActionInput<typeof createMasterValueSchema>,
): Promise<ActionResult<{ created: boolean; value: MasterValue }>> {
  return actionResult(async () => {
    const user = await requirePermission("master_data:create");
    const data = createMasterValueSchema.parse(input);

    const result = await createMasterValue({
      table: data.table,
      displayName: data.displayName,
      actorId: user.id,
    });

    revalidatePath("/settings/master-data");

    return result;
  });
}

/**
 * Disables (or re-enables) a value. Disabling never deletes: historical cases
 * referencing the value keep rendering it correctly.
 */
export async function setMasterValueActiveAction(
  input: ActionInput<typeof setMasterValueActiveSchema>,
): Promise<ActionResult<MasterValue>> {
  return actionResult(async () => {
    const user = await requirePermission("master_data:manage");
    const data = setMasterValueActiveSchema.parse(input);

    const value = await setMasterValueActive({
      table: data.table,
      id: data.id,
      isActive: data.isActive,
      actorId: user.id,
    });

    revalidatePath("/settings/master-data");

    return value;
  });
}

/**
 * One page of a master table for the administration screen.
 *
 * Search and paging happen in the database, so a value beyond the first page is
 * still findable and the screen can state how many rows there really are.
 */
export async function pageMasterValuesAction(
  input: ActionInput<typeof pageMasterValuesSchema>,
): Promise<ActionResult<MasterValuePage>> {
  return actionResult(async () => {
    await requirePermission("master_data:manage");
    const data = pageMasterValuesSchema.parse(input);

    return pageMasterValues(data);
  });
}
