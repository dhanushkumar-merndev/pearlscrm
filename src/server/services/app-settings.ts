import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logServerError } from "@/lib/errors";
import { serverEnv } from "@/lib/env/server";

/**
 * Administrator-editable application settings.
 *
 * Currently just the storage plan. Tigris exposes no plan or billing endpoint
 * on its S3-compatible API, so the application cannot discover what the clinic
 * is paying for — somebody has to tell it. Keeping that in the database rather
 * than only in an environment variable means changing plan is an edit on the
 * Storage tab, not a redeploy.
 *
 * Resolution order: the stored value, then the environment variable, then the
 * published Tigris default.
 */

export const STORAGE_SETTINGS_KEY = "storage.plan";

/**
 * Tigris's published free allowance and storage rate at the time of writing.
 *
 * Used only as the starting point for a deployment that has not set its own.
 * They are editable on the Storage tab precisely because a vendor's pricing is
 * not something this repository can keep guaranteed-current — the Tigris
 * console is the authority, and the screen says so.
 */
export const TIGRIS_FREE_TIER_BYTES = 5 * 1024 ** 3;
export const TIGRIS_DEFAULT_RATE_PER_GB_MONTH = 0.02;
export const TIGRIS_CONSOLE_URL = "https://console.tigris.dev";

export type StoragePlan = {
  /** Bytes included before storage is billed. */
  quotaBytes: number;
  /** Rate applied to whatever exceeds the allowance. */
  costPerGbMonth: number;
  currency: string;
  /** Where each value came from, so the screen can say. */
  source: "configured" | "environment" | "default";
  updatedAt: string | null;
};

type StoredPlan = {
  quotaBytes?: number;
  costPerGbMonth?: number;
  currency?: string;
};

export async function getStoragePlan(): Promise<StoragePlan> {
  const env = serverEnv();
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", STORAGE_SETTINGS_KEY)
    .maybeSingle<{ value: StoredPlan; updated_at: string }>();

  if (error) {
    // Before migration 0026 is applied the table does not exist. Falling back
    // keeps the screen working rather than failing it over a settings read.
    logServerError(new Error(`app_settings read failed: ${error.message}`));
  }

  const stored = data?.value;

  if (stored?.quotaBytes || stored?.costPerGbMonth !== undefined) {
    return {
      quotaBytes: stored.quotaBytes ?? env.TIGRIS_STORAGE_QUOTA_BYTES ?? TIGRIS_FREE_TIER_BYTES,
      costPerGbMonth:
        stored.costPerGbMonth ??
        env.TIGRIS_STORAGE_COST_PER_GB_MONTH ??
        TIGRIS_DEFAULT_RATE_PER_GB_MONTH,
      currency: stored.currency ?? env.TIGRIS_STORAGE_COST_CURRENCY,
      source: "configured",
      updatedAt: data?.updated_at ?? null,
    };
  }

  if (
    env.TIGRIS_STORAGE_QUOTA_BYTES !== undefined ||
    env.TIGRIS_STORAGE_COST_PER_GB_MONTH !== undefined
  ) {
    return {
      quotaBytes: env.TIGRIS_STORAGE_QUOTA_BYTES ?? TIGRIS_FREE_TIER_BYTES,
      costPerGbMonth: env.TIGRIS_STORAGE_COST_PER_GB_MONTH ?? TIGRIS_DEFAULT_RATE_PER_GB_MONTH,
      currency: env.TIGRIS_STORAGE_COST_CURRENCY,
      source: "environment",
      updatedAt: null,
    };
  }

  return {
    quotaBytes: TIGRIS_FREE_TIER_BYTES,
    costPerGbMonth: TIGRIS_DEFAULT_RATE_PER_GB_MONTH,
    currency: env.TIGRIS_STORAGE_COST_CURRENCY,
    source: "default",
    updatedAt: null,
  };
}

export async function setStoragePlan(params: {
  quotaBytes: number;
  costPerGbMonth: number;
  currency: string;
  actorId: string;
}): Promise<StoragePlan> {
  const admin = createSupabaseAdminClient();

  const value: StoredPlan = {
    quotaBytes: params.quotaBytes,
    costPerGbMonth: params.costPerGbMonth,
    currency: params.currency,
  };

  const { data, error } = await admin
    .from("app_settings")
    .upsert(
      {
        key: STORAGE_SETTINGS_KEY,
        value,
        updated_by: params.actorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    )
    .select("updated_at")
    .single<{ updated_at: string }>();

  if (error) throw error;

  return {
    quotaBytes: params.quotaBytes,
    costPerGbMonth: params.costPerGbMonth,
    currency: params.currency,
    source: "configured",
    updatedAt: data?.updated_at ?? null,
  };
}
