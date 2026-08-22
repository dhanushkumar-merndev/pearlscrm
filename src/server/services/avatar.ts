import "server-only";

import { deleteOrphanedObject, headObject, presignRead, presignUpload } from "@/lib/tigris/presign";
import { serverEnv } from "@/lib/env/server";
import { AppError, forbidden, logServerError, notFound, validationFailed } from "@/lib/errors";
import { extensionMatchesMime, isAllowedMimeType, type AllowedImageMimeType } from "@/lib/images";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SessionUser } from "@/server/auth/session";

type AvatarUploadSession = {
  id: string;
  user_id: string;
  object_key: string;
  expected_mime_type: AllowedImageMimeType;
  expected_file_size: number;
  status: "PENDING" | "FINALIZED" | "ABANDONED";
  expires_at: string;
};

const AVATAR_KEY = /^avatars\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png)$/i;

export async function getAvatarReadUrl(objectKey: string | null): Promise<string | null> {
  if (!objectKey) return null;

  // Profile keys can only be written by the finalization RPC. Do not sign a
  // malformed value even if a database row was somehow corrupted.
  if (!AVATAR_KEY.test(objectKey)) return null;

  const signed = await presignRead({
    objectKey,
    expiresInSeconds: serverEnv().AVATAR_READ_URL_TTL_SECONDS,
  });
  return signed.url;
}

export async function authorizeAvatarUpload(params: {
  user: SessionUser;
  filename: string;
  mimeType: AllowedImageMimeType;
  fileSize: number;
}) {
  const env = serverEnv();
  validateAvatarCandidate(params.filename, params.mimeType, params.fileSize, env.MAX_AVATAR_BYTES);

  const objectId = crypto.randomUUID();
  const extension = params.mimeType === "image/jpeg" ? "jpg" : "png";
  const objectKey = `avatars/${params.user.id}/${objectId}.${extension}`;
  const admin = createSupabaseAdminClient();

  const { data: session, error } = await admin
    .from("avatar_upload_sessions")
    .insert({
      user_id: params.user.id,
      bucket: env.TIGRIS_BUCKET,
      object_key: objectKey,
      expected_mime_type: params.mimeType,
      expected_file_size: params.fileSize,
      expires_at: new Date(Date.now() + env.UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !session) throw new AppError("INTERNAL", "Your profile photo upload could not be started.");

  const presigned = await presignUpload({
    objectKey,
    mimeType: params.mimeType,
    contentLength: params.fileSize,
  });

  return { uploadSessionId: session.id, ...presigned };
}

export async function finalizeAvatarUpload(params: { user: SessionUser; uploadSessionId: string }) {
  const admin = createSupabaseAdminClient();
  const { data: session } = await admin
    .from("avatar_upload_sessions")
    .select("*")
    .eq("id", params.uploadSessionId)
    .maybeSingle<AvatarUploadSession>();

  if (!session) throw notFound("This profile photo upload could not be found.");
  if (session.user_id !== params.user.id) throw forbidden("This profile photo upload belongs to another user.");
  if (session.status === "ABANDONED") throw validationFailed("This profile photo upload was cancelled.");
  if (new Date(session.expires_at).getTime() < Date.now() && session.status !== "FINALIZED") {
    throw validationFailed("The profile photo upload link expired. Please select the image again.");
  }

  if (session.status !== "FINALIZED") {
    const object = await headObject(session.object_key);
    if (!object.exists || object.contentLength !== session.expected_file_size) {
      throw validationFailed("The profile photo did not finish uploading. Please try again.");
    }
    if (normaliseMime(object.contentType) !== session.expected_mime_type) {
      throw validationFailed("The uploaded profile photo did not match the expected image type.");
    }
  }

  const { data: finalized, error } = await admin
    .rpc("finalize_avatar_upload", { p_session_id: session.id, p_actor: params.user.id })
    .single<{ object_key: string; previous_object_key: string | null }>();

  if (error || !finalized) throw new AppError("INTERNAL", "Your profile photo could not be saved.");

  if (finalized.previous_object_key && isOwnAvatarKey(finalized.previous_object_key, params.user.id)) {
    await deleteOrphanedObject(finalized.previous_object_key).catch((error) => {
      logServerError(error, `avatar:delete-old:${params.user.id}`);
    });
  }

  return { avatarUrl: await getAvatarReadUrl(finalized.object_key) };
}

function validateAvatarCandidate(filename: string, mimeType: string, fileSize: number, maxBytes: number): void {
  if (!isAllowedMimeType(mimeType) || !extensionMatchesMime(filename, mimeType)) {
    throw validationFailed("Choose a JPEG or PNG profile photo.");
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) throw validationFailed("The selected profile photo is empty.");
  if (fileSize > maxBytes) throw validationFailed("Profile photos must be 2 MB or smaller.");
}

function normaliseMime(value: string | undefined): string | null {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function isOwnAvatarKey(objectKey: string, userId: string): boolean {
  return AVATAR_KEY.test(objectKey) && objectKey.startsWith(`avatars/${userId}/`);
}
