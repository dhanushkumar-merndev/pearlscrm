import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AppNotification, CaseEditRequestRow } from "@/lib/types";

/**
 * Read side of in-app notifications and edit requests.
 *
 * RLS does the filtering: a notification row is visible only to its recipient,
 * and an edit request only to its requester or an administrator. These helpers
 * never widen that with the service role.
 */

type NotificationJoin = Omit<AppNotification, "case_number" | "edit_scope" | "visit_type"> & {
  cases: { case_number: string } | null;
  case_edit_requests: { scope: AppNotification["edit_scope"] } | null;
  case_visits: { visit_type: AppNotification["visit_type"] } | null;
};

const NOTIFICATION_SELECT =
  "*, cases(case_number), case_edit_requests(scope), case_visits(visit_type)";

function flattenNotification({
  cases,
  case_edit_requests,
  case_visits,
  ...row
}: NotificationJoin): AppNotification {
  return {
    ...row,
    case_number: cases?.case_number ?? null,
    edit_scope: case_edit_requests?.scope ?? null,
    visit_type: case_visits?.visit_type ?? null,
  };
}

export async function listNotifications(limit = 30): Promise<AppNotification[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<NotificationJoin[]>();

  return (data ?? []).map(flattenNotification);
}

/** The bell is intentionally an unread queue, rather than a second archive. */
export async function listUnreadNotifications(limit = 12): Promise<AppNotification[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<NotificationJoin[]>();

  return (data ?? []).map(flattenNotification);
}

export async function countUnreadNotifications(): Promise<number> {
  const supabase = await createSupabaseServerClient();

  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return count ?? 0;
}

type EditRequestJoin = Omit<
  CaseEditRequestRow,
  "case_number" | "visit_label" | "requested_by_name" | "decided_by_name"
> & {
  cases: { case_number: string } | null;
  case_visits: { display_label: string } | null;
  requester: { display_name: string } | null;
  decider: { display_name: string } | null;
};

const EDIT_REQUEST_SELECT =
  "*, cases(case_number), case_visits(display_label), " +
  "requester:profiles!case_edit_requests_requested_by_fkey(display_name), " +
  "decider:profiles!case_edit_requests_decided_by_fkey(display_name)";

function flatten(row: EditRequestJoin): CaseEditRequestRow {
  const { cases, case_visits, requester, decider, ...rest } = row;

  return {
    ...rest,
    case_number: cases?.case_number ?? "",
    visit_label: case_visits?.display_label ?? null,
    requested_by_name: requester?.display_name ?? null,
    decided_by_name: decider?.display_name ?? null,
  };
}

export type EditRequestPage = {
  rows: CaseEditRequestRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/**
 * One page of edit requests, counted and sliced in PostgreSQL.
 *
 * The decided list grows for the life of the clinic — every approval ever
 * granted stays in it — so it is paginated rather than capped. A cap would
 * quietly stop showing older decisions with nothing on screen to say so.
 */
async function pageEditRequests(params: {
  pending: boolean;
  page: number;
  pageSize: number;
}): Promise<EditRequestPage> {
  const supabase = await createSupabaseServerClient();

  const from = (params.page - 1) * params.pageSize;

  let request = supabase
    .from("case_edit_requests")
    .select(EDIT_REQUEST_SELECT, { count: "exact" });

  request = params.pending
    ? request.eq("status", "PENDING").order("requested_at", { ascending: true })
    : request.neq("status", "PENDING").order("updated_at", { ascending: false });

  const { data, count } = await request
    .range(from, from + params.pageSize - 1)
    .returns<EditRequestJoin[]>();

  const total = count ?? 0;

  return {
    rows: (data ?? []).map(flatten),
    total,
    page: params.page,
    pageSize: params.pageSize,
    pageCount: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

/** Requests awaiting a decision, oldest first — an approval queue, not a feed. */
export async function listPendingEditRequests(page = 1, pageSize = 25): Promise<EditRequestPage> {
  return pageEditRequests({ pending: true, page, pageSize });
}

export async function listDecidedEditRequests(page = 1, pageSize = 25): Promise<EditRequestPage> {
  return pageEditRequests({ pending: false, page, pageSize });
}

/** Every request raised against one case, for the case's approvals panel. */
export async function listCaseEditRequests(caseId: string): Promise<CaseEditRequestRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("case_edit_requests")
    .select(EDIT_REQUEST_SELECT)
    .eq("case_id", caseId)
    .order("requested_at", { ascending: false })
    .limit(100)
    .returns<EditRequestJoin[]>();

  return (data ?? []).map(flatten);
}
