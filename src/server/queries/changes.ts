import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuditLog } from "@/lib/types";

/**
 * Field-level change history, read from the audit log.
 *
 * `diffForAudit` records a `changes` object of `{ field: { from, to } }` on every
 * edit, with long values already collapsed to `[N characters]` — so this shows
 * *that* an assessment was rewritten without ever reproducing the narrative.
 *
 * Paginated and counted in PostgreSQL. The log grows for the life of the clinic
 * and is the last table that should ever be fetched whole.
 */

export type FieldChange = { from: unknown; to: unknown };

export type ChangeEntry = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  case_id: string | null;
  case_number: string | null;
  actor_name: string | null;
  changes: Record<string, FieldChange>;
};

export type ChangePage = {
  rows: ChangeEntry[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export async function listChanges(params: {
  page?: number;
  pageSize?: number;
  caseId?: string;
  actorId?: string;
}): Promise<ChangePage> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 25;

  const supabase = await createSupabaseServerClient();
  const from = (page - 1) * pageSize;

  let request = supabase
    .from("audit_logs")
    .select("*", { count: "exact" })
    // Only events that actually carry a before/after pair. An edit with nothing
    // recorded under `changes` has nothing to show on this screen.
    .not("metadata->changes", "is", null);

  if (params.caseId) request = request.eq("case_id", params.caseId);
  if (params.actorId) request = request.eq("actor_user_id", params.actorId);

  const { data, count } = await request
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1)
    .returns<AuditLog[]>();

  const rows = data ?? [];
  const total = count ?? 0;

  const [actorNames, caseNumbers] = await Promise.all([
    lookupProfiles(rows.map((row) => row.actor_user_id)),
    lookupCases(rows.map((row) => row.case_id)),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      action: row.action,
      entity_type: row.entity_type,
      case_id: row.case_id,
      case_number: row.case_id ? (caseNumbers.get(row.case_id) ?? null) : null,
      actor_name: row.actor_user_id ? (actorNames.get(row.actor_user_id) ?? null) : null,
      changes: (row.metadata?.changes ?? {}) as Record<string, FieldChange>,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function lookupProfiles(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", unique)
    .returns<{ id: string; display_name: string }[]>();

  return new Map((data ?? []).map((row) => [row.id, row.display_name]));
}

async function lookupCases(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("cases")
    .select("id, case_number")
    .in("id", unique)
    .returns<{ id: string; case_number: string }[]>();

  return new Map((data ?? []).map((row) => [row.id, row.case_number]));
}
