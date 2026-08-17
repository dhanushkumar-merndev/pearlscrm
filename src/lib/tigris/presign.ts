import "server-only";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { serverEnv } from "@/lib/env/server";
import { tigrisBucket, tigrisClient } from "@/lib/tigris/server";
import type { AllowedImageMimeType } from "@/lib/images";

/**
 * Presigned URL generation.
 *
 * Every URL produced here is short-lived and is generated fresh per authorized
 * request. None of them is ever persisted — the database stores only
 * `{ bucket, object_key }`.
 */

export type PresignedUpload = {
  url: string;
  objectKey: string;
  bucket: string;
  expiresInSeconds: number;
  /** Headers the browser MUST send so the signature matches. */
  requiredHeaders: Record<string, string>;
};

export async function presignUpload(params: {
  objectKey: string;
  mimeType: AllowedImageMimeType;
  contentLength: number;
}): Promise<PresignedUpload> {
  const env = serverEnv();
  const bucket = tigrisBucket();

  // Signing ContentType and ContentLength binds the URL to exactly the object
  // the server authorized — a different type or size fails the signature.
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: params.objectKey,
    ContentType: params.mimeType,
    ContentLength: params.contentLength,
  });

  const url = await getSignedUrl(tigrisClient(), command, {
    expiresIn: env.UPLOAD_URL_TTL_SECONDS,
  });

  return {
    url,
    objectKey: params.objectKey,
    bucket,
    expiresInSeconds: env.UPLOAD_URL_TTL_SECONDS,
    requiredHeaders: {
      "Content-Type": params.mimeType,
    },
  };
}

export type PresignedRead = {
  url: string;
  expiresInSeconds: number;
  expiresAt: string;
};

export async function presignRead(params: {
  objectKey: string;
  /** Filename offered if the user explicitly downloads. Never patient-identifying. */
  downloadFilename?: string;
}): Promise<PresignedRead> {
  const env = serverEnv();

  const command = new GetObjectCommand({
    Bucket: tigrisBucket(),
    Key: params.objectKey,
    ...(params.downloadFilename
      ? { ResponseContentDisposition: `attachment; filename="${params.downloadFilename}"` }
      : {}),
  });

  const url = await getSignedUrl(tigrisClient(), command, {
    expiresIn: env.READ_URL_TTL_SECONDS,
  });

  return {
    url,
    expiresInSeconds: env.READ_URL_TTL_SECONDS,
    expiresAt: new Date(Date.now() + env.READ_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

export type ObjectHead = {
  exists: boolean;
  contentLength?: number;
  contentType?: string;
  etag?: string;
  checksumSha256?: string;
};

/** Confirms the object actually landed before any metadata row is written. */
export async function headObject(objectKey: string): Promise<ObjectHead> {
  try {
    const response = await tigrisClient().send(
      new HeadObjectCommand({ Bucket: tigrisBucket(), Key: objectKey }),
    );

    return {
      exists: true,
      contentLength: response.ContentLength,
      contentType: response.ContentType,
      etag: response.ETag?.replaceAll('"', ""),
      checksumSha256: response.ChecksumSHA256,
    };
  } catch (error) {
    const name = (error as { name?: string })?.name;
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;

    if (name === "NotFound" || name === "NoSuchKey" || status === 404) {
      return { exists: false };
    }

    throw error;
  }
}

/**
 * Removes an object that was uploaded but never finalized.
 *
 * Only ever called for objects belonging to an abandoned upload session — a
 * finalized clinical original is immutable and is never deleted.
 */
export async function deleteOrphanedObject(objectKey: string): Promise<void> {
  await tigrisClient().send(
    new DeleteObjectCommand({ Bucket: tigrisBucket(), Key: objectKey }),
  );
}
