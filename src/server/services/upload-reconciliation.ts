import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logServerError } from "@/lib/errors";
import { deleteOrphanedObject, headObject } from "@/lib/tigris/presign";
import { recordAudit } from "@/server/services/audit";
import { finalizeSessionRecord, type UploadSession } from "@/server/services/images";

/**
 * Reconciliation for upload sessions that were authorized but never finalized.
 *
 * A direct-to-storage upload has an unavoidable gap: the object can land in
 * Tigris and the `finalize` call that records it can still be lost — a closed
 * tab, a dropped connection, a Worker that ran out of CPU mid-request. When
 * that happens the bytes are safe but nothing points at them, so the slot shows
 * empty and the storage cost is never reclaimed.
 *
 * Two rules, both deliberately conservative:
 *
 *   RECOVER — only when the slot holds no current version. The image would
 *   otherwise be lost outright, and recording it cannot displace anything.
 *
 *   RELEASE — every other case. If the slot has since been filled, this session
 *   was either a retry of the same file or a replacement the user abandoned;
 *   silently resurrecting it would overwrite the clinical image now on record.
 *
 * A finalized original is never touched by anything in this file.
 */

export type ReconcileOutcome = {
  /** Sessions inspected. */
  scanned: number;
  /** Orphaned objects recorded against their (previously empty) slot. */
  recovered: number;
  /** Orphaned objects deleted from storage and their session closed. */
  released: number;
};

const EMPTY: ReconcileOutcome = { scanned: 0, recovered: 0, released: 0 };

/**
 * Sessions younger than this are left alone: their `finalize` may still be in
 * flight, and the client retries for several seconds of its own accord.
 */
const IN_FLIGHT_GRACE_MS = 2 * 60 * 1000;

const SESSION_COLUMNS =
  "id, case_id, visit_id, view_type_id, bucket, object_key, expected_mime_type, " +
  "expected_file_size, status, created_by, created_at, expires_at, clinical_image_version_id";

/**
 * Reconciles the stuck sessions belonging to one visit.
 *
 * Called when a visit's image panel opens, so a lost upload heals itself the
 * next time somebody looks at the case rather than waiting for an administrator
 * to notice. Failures here are logged and swallowed — reconciliation must never
 * stop a case from rendering.
 */
export async function reconcileVisitUploads(params: {
  visitId: string;
  actorId: string;
}): Promise<ReconcileOutcome> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("image_upload_sessions")
    .select(SESSION_COLUMNS)
    .eq("visit_id", params.visitId)
    .eq("status", "PENDING")
    .lt("created_at", new Date(Date.now() - IN_FLIGHT_GRACE_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<UploadSession[]>();

  if (error) {
    logServerError(new Error(`reconcile:list:${params.visitId}: ${error.message}`));
    return EMPTY;
  }

  return reconcileSessions(data ?? [], params.actorId);
}

/**
 * Global sweep across every visit — the scheduled/administrative counterpart of
 * `reconcileVisitUploads`, for orphans nobody happens to open a case for.
 */
export async function sweepUploadSessions(params: {
  actorId: string;
  limit?: number;
}): Promise<ReconcileOutcome> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("image_upload_sessions")
    .select(SESSION_COLUMNS)
    .eq("status", "PENDING")
    .lt("created_at", new Date(Date.now() - IN_FLIGHT_GRACE_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 200)
    .returns<UploadSession[]>();

  if (error) {
    logServerError(new Error(`reconcile:sweep: ${error.message}`));
    return EMPTY;
  }

  const outcome = await reconcileSessions(data ?? [], params.actorId);

  await recordAudit({
    actorUserId: params.actorId,
    action: "IMAGE_UPLOAD_SWEPT",
    entityType: "image_upload_session",
    metadata: outcome,
  });

  return outcome;
}

/**
 * Newest-first, one slot at a time.
 *
 * The ordering matters: repeated failed attempts at the same slot are retries of
 * the same file, so the newest is the one to keep and every older one is
 * released. Working newest-first means the first session to reach an empty slot
 * wins and the rest are then correctly seen as superseded.
 */
async function reconcileSessions(
  sessions: UploadSession[],
  actorId: string,
): Promise<ReconcileOutcome> {
  const outcome: ReconcileOutcome = { scanned: 0, recovered: 0, released: 0 };

  for (const session of sessions) {
    outcome.scanned += 1;

    try {
      const result = await reconcileSession(session, actorId);
      if (result === "recovered") outcome.recovered += 1;
      if (result === "released") outcome.released += 1;
    } catch (cause) {
      // One unreachable object must not stop the rest of the sweep.
      logServerError(cause, `reconcile:session:${session.id}`);
    }
  }

  return outcome;
}

async function reconcileSession(
  session: UploadSession,
  actorId: string,
): Promise<"recovered" | "released" | "skipped"> {
  const admin = createSupabaseAdminClient();

  const head = await headObject(session.object_key);

  if (!head.exists) {
    // Authorized, never uploaded. Nothing to reclaim; just close the session so
    // it stops being counted as an orphan.
    await closeSession(session, actorId, "never_uploaded");
    return "released";
  }

  const { data: slot } = await admin
    .from("clinical_images")
    .select("id, current_version_id")
    .eq("visit_id", session.visit_id)
    .eq("view_type_id", session.view_type_id)
    .maybeSingle<{ id: string; current_version_id: string | null }>();

  if (slot?.current_version_id) {
    // The slot has been filled since. Recording this object now would supersede
    // a clinical image that is already on record, which is never the right call
    // for an upload the user never saw complete.
    await deleteOrphanedObject(session.object_key).catch((cause) => {
      logServerError(cause, `reconcile:delete:${session.id}`);
    });
    await closeSession(session, actorId, "slot_already_filled");
    return "released";
  }

  const version = await finalizeSessionRecord(session, session.created_by ?? actorId);

  await recordAudit({
    actorUserId: actorId,
    action: "IMAGE_UPLOAD_RECOVERED",
    entityType: "image_upload_session",
    entityId: session.id,
    caseId: session.case_id,
    metadata: {
      visit_id: session.visit_id,
      view_type_id: session.view_type_id,
      version_id: version.id,
      uploaded_by: session.created_by,
      authorized_at: session.created_at,
    },
  });

  return "recovered";
}

async function closeSession(
  session: UploadSession,
  actorId: string,
  reason: "never_uploaded" | "slot_already_filled",
): Promise<void> {
  const admin = createSupabaseAdminClient();

  // Guarded on PENDING so a finalize that completed in the meantime is never
  // rewritten to ABANDONED.
  await admin
    .from("image_upload_sessions")
    .update({ status: "ABANDONED" })
    .eq("id", session.id)
    .eq("status", "PENDING");

  await recordAudit({
    actorUserId: actorId,
    action: "IMAGE_UPLOAD_ABANDONED",
    entityType: "image_upload_session",
    entityId: session.id,
    caseId: session.case_id,
    metadata: {
      visit_id: session.visit_id,
      view_type_id: session.view_type_id,
      reason,
      authorized_at: session.created_at,
    },
  });
}
