import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, forbidden, notFound, validationFailed } from "@/lib/errors";
import { serverEnv } from "@/lib/env/server";
import {
  buildObjectKey,
  isWellFormedObjectKey,
  validateUploadCandidate,
  type AllowedImageMimeType,
} from "@/lib/images";
import { deleteOrphanedObject, headObject, presignRead, presignUpload } from "@/lib/tigris/presign";
import { recordAudit } from "@/server/services/audit";
import { requireEditAccess } from "@/server/services/edit-access";
import type { SessionUser } from "@/server/auth/session";
import type { ClinicalImage, ClinicalImageVersion } from "@/lib/types";

/**
 * Clinical image storage service.
 *
 * The invariants this file exists to hold:
 *   - a presigned URL is only ever minted after the case, visit and view are
 *     re-validated against the database for *this* user;
 *   - the object key is generated server-side and never accepted from a client;
 *   - an existing object is never overwritten — a replacement is a new key;
 *   - finalization verifies the object really landed before any row is written;
 *   - finalization is idempotent, so a retry cannot duplicate a version.
 */

export type UploadAuthorization = {
  uploadSessionId: string;
  url: string;
  objectKey: string;
  expiresInSeconds: number;
  requiredHeaders: Record<string, string>;
};

type UploadContext = {
  caseId: string;
  visitId: string;
  viewTypeId: string;
  visitLabel: string;
  isReplacement: boolean;
};

/**
 * Re-checks every relationship the client claimed before signing anything, and
 * refuses when the visit's images have been submitted and this user holds no
 * approved edit grant for them.
 */
async function validateUploadContext(params: {
  user: SessionUser;
  caseId: string;
  visitId: string;
  viewTypeId: string;
}): Promise<UploadContext> {
  const supabase = await createSupabaseServerClient();

  const { data: caseRow } = await supabase
    .from("cases")
    .select("id, archived_at")
    .eq("id", params.caseId)
    .maybeSingle<{ id: string; archived_at: string | null }>();

  if (!caseRow) throw notFound("This case could not be found, or you cannot access it.");
  if (caseRow.archived_at) {
    throw validationFailed("This case is archived. Restore it before uploading images.");
  }

  const { data: visit } = await supabase
    .from("case_visits")
    .select("id, case_id, display_label")
    .eq("id", params.visitId)
    .maybeSingle<{ id: string; case_id: string; display_label: string }>();

  if (!visit) throw notFound("This visit could not be found.");
  if (visit.case_id !== params.caseId) {
    throw forbidden("That visit does not belong to this case.");
  }

  // A submitted image set is closed. Reopening it needs an administrator's
  // approval, checked here rather than only in the UI.
  await requireEditAccess(
    params.user,
    { scope: "VISIT_IMAGES", caseId: params.caseId, visitId: params.visitId },
    visit.display_label,
  );

  const { data: viewType } = await supabase
    .from("image_view_types")
    .select("id, is_active")
    .eq("id", params.viewTypeId)
    .maybeSingle<{ id: string; is_active: boolean }>();

  if (!viewType?.is_active) throw notFound("That image view is not available.");

  const { data: existing } = await supabase
    .from("clinical_images")
    .select("id, current_version_id")
    .eq("visit_id", params.visitId)
    .eq("view_type_id", params.viewTypeId)
    .maybeSingle<{ id: string; current_version_id: string | null }>();

  return {
    caseId: params.caseId,
    visitId: params.visitId,
    viewTypeId: params.viewTypeId,
    visitLabel: visit.display_label,
    isReplacement: Boolean(existing?.current_version_id),
  };
}

export async function authorizeUpload(params: {
  user: SessionUser;
  caseId: string;
  visitId: string;
  viewTypeId: string;
  filename: string;
  mimeType: string;
  fileSize: number;
}): Promise<UploadAuthorization> {
  const env = serverEnv();

  const validation = validateUploadCandidate(
    params.filename,
    params.mimeType,
    params.fileSize,
    env.MAX_IMAGE_BYTES,
  );

  if (!validation.ok) throw validationFailed(validation.message);

  const context = await validateUploadContext({
    user: params.user,
    caseId: params.caseId,
    visitId: params.visitId,
    viewTypeId: params.viewTypeId,
  });

  // A fresh object id per upload is what makes replacement non-destructive:
  // the new object cannot collide with the previous one.
  const objectId = crypto.randomUUID();
  const objectKey = buildObjectKey({
    caseId: context.caseId,
    visitId: context.visitId,
    objectId,
    mimeType: validation.mimeType,
  });

  const admin = createSupabaseAdminClient();

  const { data: session, error } = await admin
    .from("image_upload_sessions")
    .insert({
      case_id: context.caseId,
      visit_id: context.visitId,
      view_type_id: context.viewTypeId,
      bucket: env.TIGRIS_BUCKET,
      object_key: objectKey,
      expected_mime_type: validation.mimeType,
      expected_file_size: params.fileSize,
      // The client filename is metadata only; it is deliberately not part of
      // the object key, which stays free of anything human-recognisable.
      original_filename: sanitizeFilename(params.filename),
      created_by: params.user.id,
      expires_at: new Date(Date.now() + env.UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !session) throw new AppError("INTERNAL", "The upload could not be started.");

  const presigned = await presignUpload({
    objectKey,
    mimeType: validation.mimeType,
    contentLength: params.fileSize,
  });

  await recordAudit({
    actorUserId: params.user.id,
    action: "IMAGE_UPLOAD_STARTED",
    entityType: "image_upload_session",
    entityId: session.id,
    caseId: context.caseId,
    metadata: {
      visit_id: context.visitId,
      view_type_id: context.viewTypeId,
      is_replacement: context.isReplacement,
      file_size: params.fileSize,
      mime_type: validation.mimeType,
    },
  });

  return {
    uploadSessionId: session.id,
    url: presigned.url,
    objectKey,
    expiresInSeconds: presigned.expiresInSeconds,
    requiredHeaders: presigned.requiredHeaders,
  };
}

type UploadSession = {
  id: string;
  case_id: string;
  visit_id: string;
  view_type_id: string;
  bucket: string;
  object_key: string;
  expected_mime_type: AllowedImageMimeType;
  expected_file_size: number;
  status: "PENDING" | "FINALIZED" | "ABANDONED";
  created_by: string | null;
  expires_at: string;
  clinical_image_version_id: string | null;
};

export async function finalizeUpload(params: {
  user: SessionUser;
  uploadSessionId: string;
  sha256?: string;
}): Promise<ClinicalImageVersion> {
  const admin = createSupabaseAdminClient();

  const { data: session } = await admin
    .from("image_upload_sessions")
    .select("*")
    .eq("id", params.uploadSessionId)
    .maybeSingle<UploadSession>();

  if (!session) throw notFound("This upload could not be found.");

  // Only the uploader (or an admin) may finalize their own session.
  if (session.created_by !== params.user.id && params.user.role !== "ADMIN") {
    throw forbidden("This upload was started by another user.");
  }

  if (session.status === "FINALIZED") {
    // Idempotent replay: a browser refresh or a retried request returns the
    // version that was already recorded rather than creating a second one.
    const { data: existing } = await admin
      .from("clinical_image_versions")
      .select("*")
      .eq("id", session.clinical_image_version_id ?? "")
      .maybeSingle<ClinicalImageVersion>();

    if (existing) return existing;
  }

  if (session.status === "ABANDONED") {
    throw validationFailed("This upload was cancelled. Please upload the image again.");
  }

  if (!isWellFormedObjectKey(session.object_key)) {
    throw new AppError("INTERNAL", "The upload could not be completed.");
  }

  // A presigned PUT proves nothing on its own — confirm the object exists and
  // matches what was authorized before any metadata row is written.
  const head = await headObject(session.object_key);

  if (!head.exists) {
    throw validationFailed(
      "The image did not finish uploading. Please try again.",
    );
  }

  if (head.contentType && head.contentType !== session.expected_mime_type) {
    await deleteOrphanedObject(session.object_key).catch(() => {});
    await admin
      .from("image_upload_sessions")
      .update({ status: "ABANDONED" })
      .eq("id", session.id);

    throw validationFailed("The uploaded file did not match the expected image type.");
  }

  const actualSize = head.contentLength ?? session.expected_file_size;

  if (actualSize > serverEnv().MAX_IMAGE_BYTES) {
    await deleteOrphanedObject(session.object_key).catch(() => {});
    throw validationFailed("The uploaded image is larger than the allowed size.");
  }

  const { data: version, error } = await admin
    .rpc("finalize_image_upload", {
      p_session_id: session.id,
      p_file_size: actualSize,
      p_sha256: params.sha256 ?? null,
      p_actor: params.user.id,
    })
    .single<ClinicalImageVersion>();

  if (error || !version) {
    throw new AppError("INTERNAL", "The image could not be recorded. Please try again.");
  }

  return version;
}

/**
 * Releases a session whose upload never completed, and removes the orphaned
 * object if one was created. Never touches a finalized original.
 */
export async function abandonUpload(params: {
  user: SessionUser;
  uploadSessionId: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { data: session } = await admin
    .from("image_upload_sessions")
    .select("*")
    .eq("id", params.uploadSessionId)
    .maybeSingle<UploadSession>();

  if (!session) return;
  if (session.status === "FINALIZED") return;

  if (session.created_by !== params.user.id && params.user.role !== "ADMIN") {
    throw forbidden("This upload was started by another user.");
  }

  await deleteOrphanedObject(session.object_key).catch(() => {});

  await admin.from("image_upload_sessions").update({ status: "ABANDONED" }).eq("id", session.id);

  await recordAudit({
    actorUserId: params.user.id,
    action: "IMAGE_UPLOAD_ABANDONED",
    entityType: "image_upload_session",
    entityId: session.id,
    caseId: session.case_id,
    metadata: { visit_id: session.visit_id, view_type_id: session.view_type_id },
  });
}

export type ImageReadUrl = {
  url: string;
  expiresAt: string;
  expiresInSeconds: number;
  mimeType: string;
};

/**
 * Mints a short-lived read URL after re-verifying that the version belongs to
 * the image, the image belongs to the case, and the caller may read that case.
 */
export async function getImageReadUrl(params: {
  user: SessionUser;
  imageId: string;
  versionId?: string;
  download?: boolean;
}): Promise<ImageReadUrl> {
  const supabase = await createSupabaseServerClient();

  // RLS decides visibility here: an unauthorized caller simply gets no row.
  const { data: image } = await supabase
    .from("clinical_images")
    .select("id, case_id, visit_id, current_version_id, availability_status")
    .eq("id", params.imageId)
    .maybeSingle<ClinicalImage>();

  if (!image) throw notFound("You do not have permission to access this image.");

  const versionId = params.versionId ?? image.current_version_id;
  if (!versionId) throw notFound("No image has been uploaded for this view.");

  const { data: version } = await supabase
    .from("clinical_image_versions")
    .select("*")
    .eq("id", versionId)
    .maybeSingle<ClinicalImageVersion>();

  if (!version) throw notFound("This image version could not be found.");

  // Belt and braces: the version must belong to the image that was authorized.
  if (version.clinical_image_id !== image.id) {
    throw forbidden("That image version does not belong to this case.");
  }

  const presigned = await presignRead({
    objectKey: version.object_key,
    ...(params.download
      ? { downloadFilename: `${image.case_id.slice(0, 8)}-${version.id.slice(0, 8)}.${extensionFor(version.mime_type)}` }
      : {}),
  });

  if (params.download) {
    await recordAudit({
      actorUserId: params.user.id,
      action: "IMAGE_DOWNLOADED",
      entityType: "clinical_image",
      entityId: image.id,
      caseId: image.case_id,
      metadata: { version_id: version.id },
    });
  }

  return {
    url: presigned.url,
    expiresAt: presigned.expiresAt,
    expiresInSeconds: presigned.expiresInSeconds,
    mimeType: version.mime_type,
  };
}

export async function markImageUnavailable(params: {
  user: SessionUser;
  caseId: string;
  visitId: string;
  viewTypeId: string;
  reason?: string;
}): Promise<ClinicalImage> {
  await validateUploadContext({
    user: params.user,
    caseId: params.caseId,
    visitId: params.visitId,
    viewTypeId: params.viewTypeId,
  });

  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .rpc("mark_image_unavailable", {
      p_visit_id: params.visitId,
      p_view_type_id: params.viewTypeId,
      p_reason: params.reason ?? null,
      p_actor: params.user.id,
    })
    .single<ClinicalImage>();

  if (error || !data) throw new AppError("INTERNAL", "The image status could not be updated.");

  return data;
}

/** Returns a NOT_AVAILABLE slot to MISSING so an image can be uploaded later. */
export async function clearImageUnavailable(params: {
  user: SessionUser;
  visitId: string;
  viewTypeId: string;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: image } = await supabase
    .from("clinical_images")
    .select("id, case_id, availability_status, current_version_id")
    .eq("visit_id", params.visitId)
    .eq("view_type_id", params.viewTypeId)
    .maybeSingle<ClinicalImage>();

  if (!image) throw notFound("This image slot could not be found.");
  if (image.availability_status !== "NOT_AVAILABLE") return;

  await requireEditAccess(params.user, {
    scope: "VISIT_IMAGES",
    caseId: image.case_id,
    visitId: params.visitId,
  });

  const { error } = await supabase
    .from("clinical_images")
    .update({
      availability_status: image.current_version_id ? "UPLOADED" : "MISSING",
      not_available_reason: null,
      not_available_by: null,
      not_available_at: null,
    })
    .eq("id", image.id);

  if (error) throw new AppError("INTERNAL", "The image status could not be updated.");

  await recordAudit({
    actorUserId: params.user.id,
    action: "IMAGE_AVAILABILITY_CLEARED",
    entityType: "clinical_image",
    entityId: image.id,
    caseId: image.case_id,
    metadata: { visit_id: params.visitId, view_type_id: params.viewTypeId },
  });
}

/**
 * Empties a slot during an authorized edit.
 *
 * "Delete" in the editing UI means the slot no longer shows that photograph. It
 * does not mean the original is destroyed: the version row survives, marked
 * superseded, and the stored object is left untouched so the replacement
 * history stays complete.
 */
export async function removeCurrentImage(params: {
  user: SessionUser;
  caseId: string;
  visitId: string;
  viewTypeId: string;
}): Promise<ClinicalImage> {
  await validateUploadContext({
    user: params.user,
    caseId: params.caseId,
    visitId: params.visitId,
    viewTypeId: params.viewTypeId,
  });

  const supabase = await createSupabaseServerClient();

  const { data: image } = await supabase
    .from("clinical_images")
    .select("id, current_version_id")
    .eq("visit_id", params.visitId)
    .eq("view_type_id", params.viewTypeId)
    .maybeSingle<{ id: string; current_version_id: string | null }>();

  if (!image) throw notFound("This image slot could not be found.");
  if (!image.current_version_id) {
    throw validationFailed("There is no image in this slot to remove.");
  }

  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .rpc("remove_current_image", {
      p_clinical_image_id: image.id,
      p_actor: params.user.id,
    })
    .single<ClinicalImage>();

  if (error || !data) throw new AppError("INTERNAL", "The image could not be removed.");

  return data;
}

/**
 * Strips path components and control characters from a client-supplied
 * filename before it is stored as metadata.
 */
function sanitizeFilename(filename: string): string {
  const segments = filename.split("/").flatMap((part) => part.split("\\"));
  const base = segments[segments.length - 1] ?? "image";

  const cleaned = [...base]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join("")
    .trim();

  return cleaned.slice(0, 255) || "image";
}

function extensionFor(mimeType: string): string {
  return mimeType === "image/png" ? "png" : "jpg";
}
