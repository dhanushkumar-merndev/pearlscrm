/**
 * Opaque-enough URL cursor for notification history.
 *
 * The cursor is only a position in an ordered feed, never an authorization
 * token. The query still runs under the caller's Supabase RLS session.
 */
export type NotificationCursor = {
  createdAt: string;
  id: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  const json = JSON.stringify(cursor);
  const bytes = new TextEncoder().encode(json);
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Returns null for malformed or tampered URL input. */
export function decodeNotificationCursor(value: string | undefined): NotificationCursor | null {
  if (!value || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;

  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("createdAt" in parsed) ||
      !("id" in parsed) ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id)
    ) {
      return null;
    }

    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;

    return { createdAt: createdAt.toISOString(), id: parsed.id };
  } catch {
    return null;
  }
}
