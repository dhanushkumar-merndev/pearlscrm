"use client";

import { validateUploadCandidate, type AllowedImageMimeType } from "@/lib/images";

/**
 * Browser side of the direct-to-Tigris upload.
 *
 * Image bytes go straight from the browser to Tigris; they never pass through a
 * Next.js request. The application server only authorizes the upload and then
 * records metadata once the object has landed.
 */

export type UploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

export type UploadTarget = {
  caseId: string;
  visitId: string;
  viewTypeId: string;
};

export type UploadResult = {
  versionId: string;
  clinicalImageId: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
};

export class UploadError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = "UploadError";
    this.retryable = retryable;
  }
}

type AuthorizeResponse = {
  uploadSessionId: string;
  url: string;
  objectKey: string;
  expiresInSeconds: number;
  requiredHeaders: Record<string, string>;
};

/**
 * Runs the full flow: authorize -> direct PUT -> finalize.
 *
 * The session id is surfaced through `onSession` so a caller can finalize a
 * retry, or abandon the session, after a page refresh.
 */
export async function uploadClinicalImage(params: {
  file: File;
  target: UploadTarget;
  maxBytes: number;
  onProgress?: (progress: UploadProgress) => void;
  onSession?: (uploadSessionId: string) => void;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  const { file, target, maxBytes } = params;

  // Client-side validation is for immediate feedback only — the server repeats
  // all of it before signing anything.
  const validation = validateUploadCandidate(file.name, file.type, file.size, maxBytes);
  if (!validation.ok) throw new UploadError(validation.message);

  const authorization = await authorize({
    ...target,
    filename: file.name,
    mimeType: validation.mimeType,
    fileSize: file.size,
  });

  params.onSession?.(authorization.uploadSessionId);

  // Hashed before upload so the digest describes exactly the bytes that were
  // sent, giving the stored original a verifiable integrity value.
  const sha256 = await sha256Hex(file);

  await putObject({
    url: authorization.url,
    file,
    headers: authorization.requiredHeaders,
    onProgress: params.onProgress,
    signal: params.signal,
  });

  return finalize(authorization.uploadSessionId, sha256);
}

async function authorize(body: {
  caseId: string;
  visitId: string;
  viewTypeId: string;
  filename: string;
  mimeType: AllowedImageMimeType;
  fileSize: number;
}): Promise<AuthorizeResponse> {
  const response = await fetch("/api/uploads/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new UploadError(await errorMessage(response));

  return (await response.json()) as AuthorizeResponse;
}

/**
 * XHR rather than fetch: it is still the only way to observe upload progress
 * reliably across browsers.
 */
function putObject(params: {
  url: string;
  file: File;
  headers: Record<string, string>;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", params.url, true);

    for (const [name, value] of Object.entries(params.headers)) {
      request.setRequestHeader(name, value);
    }

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      params.onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      });
    });

    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }

      // 403 here is almost always an expired signature rather than a genuine
      // permission problem — the presigned URL outlived the attempt.
      reject(
        new UploadError(
          request.status === 403
            ? "The upload link expired before the image finished uploading. Please try again."
            : "The image could not be uploaded to secure storage.",
          true,
        ),
      );
    });

    request.addEventListener("error", () =>
      reject(new UploadError("The network connection was interrupted during upload.", true)),
    );

    request.addEventListener("abort", () => reject(new UploadError("Upload cancelled.")));

    params.signal?.addEventListener("abort", () => request.abort(), { once: true });

    request.send(params.file);
  });
}

/**
 * Finalization is idempotent server-side, so retrying after a transient failure
 * cannot create a duplicate version record.
 */
async function finalize(uploadSessionId: string, sha256?: string): Promise<UploadResult> {
  const response = await fetch("/api/uploads/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadSessionId, sha256 }),
  });

  if (!response.ok) throw new UploadError(await errorMessage(response), true);

  return (await response.json()) as UploadResult;
}

export async function abandonUploadSession(uploadSessionId: string): Promise<void> {
  await fetch("/api/uploads/abandon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadSessionId }),
    keepalive: true,
  }).catch(() => {});
}

/** SHA-256 of the original bytes, via WebCrypto. */
async function sha256Hex(file: File): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;

  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    // Hashing is best-effort: an unavailable WebCrypto must not block an upload.
    return undefined;
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? "The upload could not be completed.";
  } catch {
    return "The upload could not be completed.";
  }
}
