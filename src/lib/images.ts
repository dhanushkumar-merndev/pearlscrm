/**
 * Clinical image rules shared by client and server.
 *
 * Object keys are built only from UUIDs. Case numbers, filenames, and anything
 * else a person could recognise stay out of the key entirely — the key is not
 * the security boundary, but it must not leak either.
 */

export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png"] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/**
 * HEIC/HEIF is intentionally absent: browser decoding is not implemented, and
 * accepting it would produce previews that silently fail to render.
 */
export const ALLOWED_IMAGE_EXTENSIONS: Record<AllowedImageMimeType, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
};

/** 5 MB. Mirrors the `MAX_IMAGE_BYTES` server default. */
export const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function isAllowedMimeType(value: string): value is AllowedImageMimeType {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function fileExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** The extension must agree with the declared MIME type. */
export function extensionMatchesMime(filename: string, mimeType: AllowedImageMimeType): boolean {
  return ALLOWED_IMAGE_EXTENSIONS[mimeType].includes(fileExtension(filename));
}

export type UploadValidationResult =
  | { ok: true; mimeType: AllowedImageMimeType }
  | { ok: false; code: "mime" | "extension" | "size" | "empty"; message: string };

export function validateUploadCandidate(
  filename: string,
  mimeType: string,
  fileSize: number,
  maxBytes: number = DEFAULT_MAX_IMAGE_BYTES,
): UploadValidationResult {
  if (!isAllowedMimeType(mimeType)) {
    return {
      ok: false,
      code: "mime",
      message: "Only JPEG and PNG clinical images are accepted.",
    };
  }

  if (!extensionMatchesMime(filename, mimeType)) {
    return {
      ok: false,
      code: "extension",
      message: "The file extension does not match the image type.",
    };
  }

  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return { ok: false, code: "empty", message: "The selected file is empty." };
  }

  if (fileSize > maxBytes) {
    return {
      ok: false,
      code: "size",
      message: `Images must be ${formatBytes(maxBytes)} or smaller.`,
    };
  }

  return { ok: true, mimeType };
}

const OBJECT_EXTENSION: Record<AllowedImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

/**
 * `clinical/{case_uuid}/{visit_uuid}/{image_uuid}/original.{ext}`
 *
 * `imageUuid` is a fresh UUID per uploaded object, so a replacement always
 * lands on a new key and an existing object is never overwritten.
 */
export function buildObjectKey(params: {
  caseId: string;
  visitId: string;
  objectId: string;
  mimeType: AllowedImageMimeType;
}): string {
  const { caseId, visitId, objectId, mimeType } = params;

  for (const [name, value] of Object.entries({ caseId, visitId, objectId })) {
    if (!isUuid(value)) {
      throw new Error(`${name} must be a UUID to build an object key`);
    }
  }

  return `clinical/${caseId}/${visitId}/${objectId}/original.${OBJECT_EXTENSION[mimeType]}`;
}

/** Guards the finalize step: the key must be the one the server itself issued. */
export function isWellFormedObjectKey(key: string): boolean {
  const match = /^clinical\/([^/]+)\/([^/]+)\/([^/]+)\/original\.(jpg|png)$/.exec(key);
  if (!match) return false;

  return [match[1], match[2], match[3]].every(isUuid);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
