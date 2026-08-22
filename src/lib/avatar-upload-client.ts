"use client";

import { isAllowedMimeType, validateUploadCandidate } from "@/lib/images";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

type AuthorizeResponse = {
  uploadSessionId: string;
  url: string;
  requiredHeaders: Record<string, string>;
};

/** Uploads a small profile photo directly to private Tigris storage. */
export async function uploadAvatar(file: File): Promise<void> {
  const validation = validateUploadCandidate(file.name, file.type, file.size, MAX_AVATAR_BYTES);
  if (!validation.ok || !isAllowedMimeType(file.type)) {
    throw new Error(validation.ok ? "Choose a JPEG or PNG profile photo." : validation.message);
  }

  const authorizeResponse = await fetch("/api/avatar/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      mimeType: validation.mimeType,
      fileSize: file.size,
    }),
  });
  if (!authorizeResponse.ok) throw new Error(await safeError(authorizeResponse));

  const authorization = (await authorizeResponse.json()) as AuthorizeResponse;
  const putResponse = await fetch(authorization.url, {
    method: "PUT",
    headers: authorization.requiredHeaders,
    body: file,
  });
  if (!putResponse.ok) {
    throw new Error(
      putResponse.status === 403
        ? "The upload link expired. Please select the profile photo again."
        : "The profile photo could not be uploaded to secure storage.",
    );
  }

  const finalizeResponse = await fetch("/api/avatar/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadSessionId: authorization.uploadSessionId }),
  });
  if (!finalizeResponse.ok) throw new Error(await safeError(finalizeResponse));
}

async function safeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? "The profile photo could not be saved.";
  } catch {
    return "The profile photo could not be saved.";
  }
}
