import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CaseReviewComment, CaseReviewCommentWithAuthor, RoleCode } from "@/lib/types";

/**
 * The discussion thread on a case's expert review, oldest first.
 *
 * Read through the caller's own session, so RLS decides visibility: a user who
 * cannot see the case gets an empty thread rather than an error.
 */
export async function getReviewComments(
  caseId: string,
): Promise<CaseReviewCommentWithAuthor[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("case_review_comments")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true })
    .limit(200)
    .returns<CaseReviewComment[]>();

  const comments = data ?? [];
  if (comments.length === 0) return [];

  const authorIds = [...new Set(comments.map((comment) => comment.author_id))];

  const { data: authors } = await supabase
    .from("profiles")
    .select("id, display_name, roles(code)")
    .in("id", authorIds)
    .returns<{ id: string; display_name: string; roles: { code: RoleCode } | null }[]>();

  const byId = new Map((authors ?? []).map((author) => [author.id, author]));

  return comments.map((comment) => ({
    ...comment,
    author_name: byId.get(comment.author_id)?.display_name ?? "Unknown user",
    author_role: byId.get(comment.author_id)?.roles?.code ?? null,
  }));
}
