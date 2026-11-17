import "server-only";

import {
  buildDocumentKey,
  isWellFormedDocumentKey,
  validateDocumentCandidate,
  type DocumentMimeType,
} from "@/lib/documents";
import { serverEnv } from "@/lib/env/server";
import { AppError, forbidden, logServerError, notFound, validationFailed } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteOrphanedObject, headObject, presignRead, presignUpload } from "@/lib/tigris/presign";
import type { PatientDocument } from "@/lib/types";
import type { SessionUser } from "@/server/auth/session";
import { recordAudit } from "@/server/services/audit";
import { rpcError } from "@/server/services/rpc-errors";

/**
 * Prescription uploads. Same shape as clinical images: authorize (validate,
 * open a session, presign a PUT bound to type and size) → the browser uploads
 * straight to Tigris → finalize (HEAD the object, then one idempotent RPC).
 * Documents are immutable originals; nothing here overwrites or deletes one.
 */

type DocumentSession = {
  id: string;
  patient_id: string;
  object_key: string;
  expected_mime_type: DocumentMimeType;
  expected_file_size: number;
  status: "PENDING" | "FINALIZED" | "ABANDONED";
  created_by: string | null;
  document_id: string | null;
};

export type DocumentUploadAuthorization = {
  uploadSessionId: string;
  url: string;
  expiresInSeconds: number;
  requiredHeaders: Record<string, string>;
};

export async function authorizeDocumentUpload(params: {
  user: SessionUser;
  patientId: string;
  consultationId: string | null;
  kind: "PRESCRIPTION" | "OTHER";
  filename: string;
  mimeType: string;
  fileSize: number;
}): Promise<DocumentUploadAuthorization> {
  const check = validateDocumentCandidate(params.filename, params.mimeType, params.fileSize);
  if (!check.ok) throw validationFailed(check.message);

  // Visibility through the caller's own session: RLS decides.
  const supabase = await createSupabaseServerClient();
  const { data: patient } = await supabase
    .from("patients")
    .select("id, archived_at")
    .eq("id", params.patientId)
    .maybeSingle<{ id: string; archived_at: string | null }>();
  if (!patient) throw notFound("This patient could not be found.");
  if (patient.archived_at) throw validationFailed("This patient record is archived.");

  if (params.consultationId) {
    const { data: consultation } = await supabase
      .from("patient_consultations")
      .select("id")
      .eq("id", params.consultationId)
      .eq("patient_id", params.patientId)
      .maybeSingle();
    if (!consultation) throw validationFailed("That visit does not belong to this patient.");
  }

  const env = serverEnv();
  const objectKey = buildDocumentKey(params.patientId, crypto.randomUUID(), check.mimeType);
  const admin = createSupabaseAdminClient();

  const { data: session, error } = await admin
    .from("document_upload_sessions")
    .insert({
      patient_id: params.patientId,
      consultation_id: params.consultationId,
      kind: params.kind,
      bucket: env.TIGRIS_BUCKET,
      object_key: objectKey,
      expected_mime_type: check.mimeType,
      expected_file_size: params.fileSize,
      original_filename: sanitizeFilename(params.filename),
      created_by: params.user.id,
      expires_at: new Date(Date.now() + env.UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !session) throw new AppError("INTERNAL", "The upload could not be started.");

  const presigned = await presignUpload({
    objectKey,
    mimeType: check.mimeType,
    contentLength: params.fileSize,
  });

  await recordAudit({
    actorUserId: params.user.id,
    action: "PRESCRIPTION_UPLOAD_STARTED",
    entityType: "document_upload_session",
    entityId: session.id,
    metadata: { patient_id: params.patientId, mime_type: check.mimeType, file_size: params.fileSize },
  });

  return {
    uploadSessionId: session.id,
    url: presigned.url,
    expiresInSeconds: presigned.expiresInSeconds,
    requiredHeaders: presigned.requiredHeaders,
  };
}

async function loadSession(id: string): Promise<DocumentSession> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("document_upload_sessions")
    .select("id, patient_id, object_key, expected_mime_type, expected_file_size, status, created_by, document_id")
    .eq("id", id)
    .maybeSingle<DocumentSession>();
  if (!data) throw notFound("This upload could not be found.");
  return data;
}

export async function finalizeDocumentUpload(params: {
  user: SessionUser;
  uploadSessionId: string;
  sha256?: string;
}): Promise<PatientDocument> {
  const session = await loadSession(params.uploadSessionId);
  if (session.created_by !== params.user.id) throw forbidden("This upload was started by another user.");
  const admin = createSupabaseAdminClient();

  if (session.status === "PENDING") {
    if (!isWellFormedDocumentKey(session.object_key)) {
      throw new AppError("INTERNAL", "The upload could not be completed.");
    }

    let head: Awaited<ReturnType<typeof headObject>>;
    try {
      head = await headObject(session.object_key);
    } catch (cause) {
      logServerError(cause, `document-finalize:head:${session.id}`);
      throw new AppError("INTERNAL", "Secure storage could not confirm the upload. Please try again.");
    }

    if (!head.exists) throw validationFailed("The file did not finish uploading. Please try again.");

    if (
      (head.contentType && head.contentType !== session.expected_mime_type) ||
      (head.contentLength !== undefined && head.contentLength !== session.expected_file_size)
    ) {
      await deleteOrphanedObject(session.object_key).catch(() => {});
      await admin.from("document_upload_sessions").update({ status: "ABANDONED" }).eq("id", session.id);
      throw validationFailed("The uploaded file did not match what was authorized.");
    }
  }

  const { data: document, error } = await admin
    .rpc("finalize_document_upload", {
      p_session_id: session.id,
      p_file_size: session.expected_file_size,
      p_sha256: params.sha256 ?? null,
      p_actor: params.user.id,
    })
    .single<PatientDocument & { object_key?: string; bucket?: string }>();

  if (error || !document) {
    if (error) logServerError(new Error(`finalize_document_upload: ${error.code} ${error.message}`), `document-finalize:${session.id}`);
    throw rpcError(error, "The prescription was stored but could not be recorded. Please try again.");
  }

  // Storage coordinates never cross to the browser.
  const { object_key: _key, bucket: _bucket, ...safe } = document;
  void _key;
  void _bucket;
  return safe;
}

export async function abandonDocumentUpload(params: { user: SessionUser; uploadSessionId: string }): Promise<void> {
  const session = await loadSession(params.uploadSessionId).catch(() => null);
  if (!session || session.status !== "PENDING") return;
  if (session.created_by !== params.user.id) throw forbidden("This upload was started by another user.");

  await deleteOrphanedObject(session.object_key).catch(() => {});
  await createSupabaseAdminClient()
    .from("document_upload_sessions")
    .update({ status: "ABANDONED" })
    .eq("id", session.id)
    .eq("status", "PENDING");
}

export async function getDocumentReadUrl(params: {
  user: SessionUser;
  documentId: string;
}): Promise<{ url: string; expiresAt: string; mimeType: string }> {
  // RLS on patient_documents decides who may read; no row means no access.
  const supabase = await createSupabaseServerClient();
  const { data: document } = await supabase
    .from("patient_documents")
    .select("id, patient_id, object_key, mime_type")
    .eq("id", params.documentId)
    .maybeSingle<{ id: string; patient_id: string; object_key: string; mime_type: string }>();

  if (!document) throw notFound("You do not have permission to open this document.");
  if (!isWellFormedDocumentKey(document.object_key)) throw new AppError("INTERNAL", "This document could not be opened.");

  const presigned = await presignRead({ objectKey: document.object_key });

  await recordAudit({
    actorUserId: params.user.id,
    action: "PRESCRIPTION_VIEWED",
    entityType: "patient_document",
    entityId: document.id,
    metadata: { patient_id: document.patient_id },
  });

  return { url: presigned.url, expiresAt: presigned.expiresAt, mimeType: document.mime_type };
}

function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "document";
  const cleaned = [...base]
    .filter((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join("")
    .trim();
  return cleaned.slice(0, 255) || "document";
}
