"use client";

import { validateDocumentCandidate } from "@/lib/documents";
import { UploadError, errorMessage, putObject, sha256Hex, type UploadProgress } from "@/lib/upload-client";
import type { PatientDocument } from "@/lib/types";

/** Prescription upload: authorize → direct PUT to Tigris → idempotent finalize. */
export async function uploadPatientDocument(params: {
  file: File;
  patientId: string;
  consultationId?: string | null;
  onProgress?: (progress: UploadProgress) => void;
}): Promise<PatientDocument> {
  const { file } = params;
  const check = validateDocumentCandidate(file.name, file.type, file.size);
  if (!check.ok) throw new UploadError(check.message);

  const authorize = await fetch("/api/documents/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientId: params.patientId,
      consultationId: params.consultationId ?? null,
      kind: "PRESCRIPTION",
      filename: file.name,
      mimeType: check.mimeType,
      fileSize: file.size,
    }),
  });
  if (!authorize.ok) {
    throw new UploadError(await errorMessage(authorize, "The upload could not be started."), authorize.status >= 500);
  }
  const session = (await authorize.json()) as {
    uploadSessionId: string;
    url: string;
    requiredHeaders: Record<string, string>;
  };

  const sha256 = await sha256Hex(file);

  try {
    await putObject({ url: session.url, file, headers: session.requiredHeaders, onProgress: params.onProgress });
  } catch (error) {
    void fetch("/api/documents/abandon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadSessionId: session.uploadSessionId }),
      keepalive: true,
    }).catch(() => {});
    throw error;
  }

  // Finalize is idempotent server-side, so a retry can never record it twice.
  let last: UploadError | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("/api/documents/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadSessionId: session.uploadSessionId, sha256 }),
    }).catch(() => null);
    if (response?.ok) return (await response.json()) as PatientDocument;
    last = new UploadError(
      response ? await errorMessage(response, "The file uploaded but could not be recorded yet.") : "Network error.",
      !response || response.status >= 500,
    );
    if (!last.retryable) break;
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw last ?? new UploadError("The file could not be recorded.");
}
