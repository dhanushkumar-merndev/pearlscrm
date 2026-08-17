import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/server/auth/session";
import { AUDIT_ACTIONS } from "@/server/services/audit";
import type { z } from "zod";
import type { auditQuerySchema } from "@/lib/validation/schemas";
import type { AuditLog } from "@/lib/types";

/**
 * Audit log read model (admin only).
 *
 * Details are rendered from `metadata`, which by construction holds changed
 * field names and safe scalars — never clinical narrative or secrets.
 */

export type AuditLogRow = AuditLog & {
  actor_name: string | null;
  case_number: string | null;
};

export type AuditListResult = {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export const AUDIT_ACTION_OPTIONS = [...AUDIT_ACTIONS].sort();

export async function listAuditLogs(
  query: z.infer<typeof auditQuerySchema>,
): Promise<AuditListResult> {
  await requirePermission("audit:read");

  const supabase = await createSupabaseServerClient();

  let request = supabase.from("audit_logs").select("*", { count: "exact" });

  if (query.from) request = request.gte("created_at", `${query.from}T00:00:00Z`);
  if (query.to) request = request.lte("created_at", `${query.to}T23:59:59.999Z`);
  if (query.actorId) request = request.eq("actor_user_id", query.actorId);
  if (query.action) request = request.eq("action", query.action);
  if (query.caseId) request = request.eq("case_id", query.caseId);
  if (query.entityType) request = request.eq("entity_type", query.entityType);

  const from = (query.page - 1) * query.pageSize;

  const { data, error, count } = await request
    .order("created_at", { ascending: false })
    .range(from, from + query.pageSize - 1)
    .returns<AuditLog[]>();

  if (error) throw new AppError("INTERNAL", "Could not load the audit log.");

  const rows = data ?? [];

  const actorIds = [
    ...new Set(rows.map((row) => row.actor_user_id).filter((id): id is string => Boolean(id))),
  ];
  const caseIds = [
    ...new Set(rows.map((row) => row.case_id).filter((id): id is string => Boolean(id))),
  ];

  const [actorNames, caseNumbers] = await Promise.all([
    lookupNames(actorIds),
    lookupCaseNumbers(caseIds),
  ]);

  const total = count ?? 0;

  return {
    rows: rows.map((row) => ({
      ...row,
      actor_name: row.actor_user_id ? (actorNames.get(row.actor_user_id) ?? null) : null,
      case_number: row.case_id ? (caseNumbers.get(row.case_id) ?? null) : null,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

async function lookupNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", ids)
    .returns<{ id: string; display_name: string }[]>();

  return new Map((data ?? []).map((row) => [row.id, row.display_name]));
}

async function lookupCaseNumbers(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("cases")
    .select("id, case_number")
    .in("id", ids)
    .returns<{ id: string; case_number: string }[]>();

  return new Map((data ?? []).map((row) => [row.id, row.case_number]));
}

/** Case-level history for the Audit History tab. */
export async function getCaseAuditHistory(caseId: string, limit = 200): Promise<AuditLogRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<AuditLog[]>();

  const rows = data ?? [];
  const actorIds = [
    ...new Set(rows.map((row) => row.actor_user_id).filter((id): id is string => Boolean(id))),
  ];
  const actorNames = await lookupNames(actorIds);

  return rows.map((row) => ({
    ...row,
    actor_name: row.actor_user_id ? (actorNames.get(row.actor_user_id) ?? null) : null,
    case_number: null,
  }));
}
