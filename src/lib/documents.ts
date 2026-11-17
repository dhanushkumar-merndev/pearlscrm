/**
 * Prescription / patient document rules, shared by client and server.
 *
 * Keys follow the same shape as clinical images — UUIDs only, nothing a person
 * could recognise — under a separate `patients/` prefix:
 *   patients/{patient_uuid}/documents/{document_uuid}/original.{pdf|jpg|png}
 */

export const DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type DocumentMimeType = (typeof DOCUMENT_MIME_TYPES)[number];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<DocumentMimeType, string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function documentExtension(mimeType: DocumentMimeType): string {
  return mimeType === "application/pdf" ? "pdf" : mimeType === "image/png" ? "png" : "jpg";
}

export function buildDocumentKey(patientId: string, documentId: string, mimeType: DocumentMimeType): string {
  if (!UUID.test(patientId) || !UUID.test(documentId)) throw new Error("Document keys are built from UUIDs only.");
  return `patients/${patientId}/documents/${documentId}/original.${documentExtension(mimeType)}`;
}

export function isWellFormedDocumentKey(key: string): boolean {
  const match = /^patients\/([^/]+)\/documents\/([^/]+)\/original\.(pdf|jpg|png)$/.exec(key);
  return Boolean(match && UUID.test(match[1]!) && UUID.test(match[2]!));
}

export type DocumentCheck = { ok: true; mimeType: DocumentMimeType } | { ok: false; message: string };

export function validateDocumentCandidate(filename: string, mimeType: string, fileSize: number): DocumentCheck {
  if (!(DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { ok: false, message: "Upload a PDF, JPEG or PNG file." };
  }
  const type = mimeType as DocumentMimeType;
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!EXTENSIONS[type].includes(extension)) {
    return { ok: false, message: "The file extension does not match its type." };
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) return { ok: false, message: "The file is empty." };
  if (fileSize > MAX_DOCUMENT_BYTES) return { ok: false, message: "Documents must be 10 MB or smaller." };
  return { ok: true, mimeType: type };
}
