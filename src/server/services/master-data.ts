import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, validationFailed } from "@/lib/errors";
import { normalizeMasterKey } from "@/lib/master-data";
import type { MasterTable, MasterValue } from "@/lib/types";

/**
 * The self-learning dropdown backend.
 *
 * Creating a value is delegated to `public.upsert_master_value`, whose
 * insert-first + `on conflict do nothing` strategy makes concurrent creation of
 * the same term resolve to a single row via the unique index rather than via a
 * read-then-write race in application code.
 */

export type MasterValueSearchResult = {
  values: MasterValue[];
  /** The exact case-insensitive match for the query, if one exists. */
  exactMatch: MasterValue | null;
};

export async function searchMasterValues(params: {
  table: MasterTable;
  query: string;
  limit?: number;
  /** Keeps a currently-selected inactive value visible while editing history. */
  includeInactiveId?: string;
}): Promise<MasterValueSearchResult> {
  const supabase = await createSupabaseServerClient();
  const limit = params.limit ?? 20;
  const normalized = normalizeMasterKey(params.query);

  let request = supabase
    .from(params.table)
    .select("*")
    .order("usage_count", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("display_name", { ascending: true })
    .limit(limit);

  // Inactive values are not suggested for new selections, but an inactive value
  // already attached to a historical record must still render.
  request = params.includeInactiveId
    ? request.or(`is_active.eq.true,id.eq.${params.includeInactiveId}`)
    : request.eq("is_active", true);

  if (normalized) {
    request = request.ilike("normalized_key", `%${escapeLikePattern(normalized)}%`);
  }

  const { data, error } = await request.returns<MasterValue[]>();

  if (error) throw new AppError("INTERNAL", "Could not load options.");

  const values = data ?? [];
  const exactMatch = normalized
    ? (values.find((value) => value.normalized_key === normalized) ??
      (await findByKey(params.table, normalized)))
    : null;

  return { values, exactMatch: exactMatch ?? null };
}

async function findByKey(table: MasterTable, normalizedKey: string): Promise<MasterValue | null> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from(table)
    .select("*")
    .eq("normalized_key", normalizedKey)
    .maybeSingle<MasterValue>();

  return data ?? null;
}

export type CreateMasterValueResult = {
  created: boolean;
  value: MasterValue;
};

/**
 * Creates a value, or returns the existing one when the normalized key already
 * exists. Callers can select the returned value immediately either way.
 */
export async function createMasterValue(params: {
  table: MasterTable;
  displayName: string;
  actorId: string;
}): Promise<CreateMasterValueResult> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc("upsert_master_value", {
    p_table: params.table,
    p_display_name: params.displayName,
    p_actor: params.actorId,
  });

  if (error) {
    if (error.code === "22023" || error.code === "22001") {
      throw validationFailed(error.message);
    }
    throw new AppError("INTERNAL", "Could not save the new value.");
  }

  const result = data as { created: boolean; value: MasterValue };

  if (!result?.value) {
    throw new AppError("INTERNAL", "Could not save the new value.");
  }

  return { created: result.created, value: result.value };
}

export async function setMasterValueActive(params: {
  table: MasterTable;
  id: string;
  isActive: boolean;
  actorId: string;
}): Promise<MasterValue> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.rpc("set_master_value_active", {
    p_table: params.table,
    p_id: params.id,
    p_is_active: params.isActive,
    p_actor: params.actorId,
  });

  if (error) {
    if (error.code === "P0002") throw new AppError("NOT_FOUND", "That value no longer exists.");
    throw new AppError("INTERNAL", "Could not update the value.");
  }

  return data as MasterValue;
}

export async function listMasterValues(params: {
  table: MasterTable;
  query?: string;
  includeInactive?: boolean;
}): Promise<MasterValue[]> {
  const supabase = await createSupabaseServerClient();

  let request = supabase
    .from(params.table)
    .select("*")
    .order("display_name", { ascending: true })
    .limit(500);

  if (!params.includeInactive) request = request.eq("is_active", true);

  const normalized = normalizeMasterKey(params.query ?? "");
  if (normalized) {
    request = request.ilike("normalized_key", `%${escapeLikePattern(normalized)}%`);
  }

  const { data, error } = await request.returns<MasterValue[]>();
  if (error) throw new AppError("INTERNAL", "Could not load master data.");

  return data ?? [];
}

/** Escapes PostgREST `ilike` wildcards so a typed `%` searches literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}
