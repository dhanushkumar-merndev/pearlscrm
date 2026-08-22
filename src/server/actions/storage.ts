"use server";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { updateStoragePlanSchema } from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requirePermission } from "@/server/auth/session";
import { recordAudit } from "@/server/services/audit";
import { getStoragePlan, setStoragePlan, type StoragePlan } from "@/server/services/app-settings";
import { actionResult, type ActionResult } from "@/server/actions/result";

/**
 * The storage allowance and rate shown on the Storage tab.
 *
 * These are not measurements — Tigris publishes no plan or billing endpoint on
 * its S3-compatible API — so an administrator records what the clinic's plan
 * actually provides and the screen computes against it.
 */
export async function updateStoragePlanAction(
  input: ActionInput<typeof updateStoragePlanSchema>,
): Promise<ActionResult<StoragePlan>> {
  return actionResult(async () => {
    const user = await requirePermission("user:manage");
    const data = updateStoragePlanSchema.parse(input);

    const before = await getStoragePlan();
    const quotaBytes = Math.round(data.quotaGb * 1024 ** 3);

    let plan: StoragePlan;

    try {
      plan = await setStoragePlan({
        quotaBytes,
        costPerGbMonth: data.costPerGbMonth,
        currency: data.currency,
        actorId: user.id,
      });
    } catch {
      throw new AppError(
        "INTERNAL",
        "The storage plan could not be saved. Apply the pending database migrations and try again.",
      );
    }

    await recordAudit({
      actorUserId: user.id,
      action: "STORAGE_PLAN_UPDATED",
      entityType: "app_settings",
      metadata: {
        quota_bytes: { from: before.quotaBytes, to: plan.quotaBytes },
        cost_per_gb_month: { from: before.costPerGbMonth, to: plan.costPerGbMonth },
        currency: { from: before.currency, to: plan.currency },
      },
    });

    revalidatePath("/settings");

    return plan;
  });
}
