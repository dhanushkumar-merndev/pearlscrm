/**
 * Web push through Firebase Cloud Messaging (HTTP v1).
 *
 * Ported from the Pearl Sales CRM's `push-send` function (same Firebase
 * project, same service account) and reshaped for browsers: the message
 * carries a `webpush` block instead of an `android` one, and there is no
 * Android path at all. Pure logic here — no I/O — so it is unit-tested;
 * `src/server/services/push.ts` wires in the real database and network.
 *
 * Runs on Cloudflare Workers: the Google access token is minted with
 * WebCrypto (RS256), not `firebase-admin`.
 */
import { z } from "zod";

export const serviceAccountSchema = z.object({
  client_email: z.string().min(3),
  private_key: z.string().includes("PRIVATE KEY"),
  project_id: z.string().min(1).optional(),
  token_uri: z.string().url().optional(),
});
export type ServiceAccount = z.infer<typeof serviceAccountSchema>;

export const payloadSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string().default(""),
  case_id: z.string().nullable().optional(),
  visit_id: z.string().nullable().optional(),
  visit_type: z.string().nullable().optional(),
  read: z.boolean().default(false),
  tokens: z.array(z.string()).default([]),
});
export type Payload = z.infer<typeof payloadSchema>;

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Parses FCM_SERVICE_ACCOUNT_JSON; null when absent or malformed. */
export function parseServiceAccount(raw: string | undefined | null): ServiceAccount | null {
  if (!raw) return null;
  try {
    const parsed = serviceAccountSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const b64url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlText = (text: string) => b64url(new TextEncoder().encode(text));

/** PEM "-----BEGIN PRIVATE KEY-----…" → PKCS#8 bytes. Accepts "\n" written as two characters. */
export function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** The signed assertion Google trades for an access token (RFC 7523, RS256, 1 hour). */
export async function signedAssertion(sa: ServiceAccount, nowSeconds: number): Promise<string> {
  const header = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(
    JSON.stringify({
      iss: sa.client_email,
      scope: FCM_SCOPE,
      aud: sa.token_uri ?? GOOGLE_TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key) as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${b64url(new Uint8Array(signature))}`;
}

/**
 * One FCM v1 message for a browser. Data only: our service worker
 * (`public/firebase-messaging-sw.js`) shows it, so the look and the click
 * target are ours. `link` must be same-origin; it is built from ids only.
 */
export function fcmWebMessage(token: string, p: Payload, link: string): Record<string, unknown> {
  return {
    message: {
      token,
      data: {
        id: p.id,
        type: p.type,
        title: p.title.slice(0, 200),
        body: p.body.slice(0, 1000),
        link,
      },
      webpush: {
        headers: { Urgency: "high", TTL: "86400" },
        fcm_options: { link },
      },
    },
  };
}

export type SendOutcome = "sent" | "gone" | "auth" | "failed";

/** Firebase's answer → what to do. https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode */
export function classify(status: number, body: unknown): SendOutcome {
  if (status >= 200 && status < 300) return "sent";
  const err = (
    body as {
      error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
    } | null
  )?.error;
  const codes = [err?.status, ...(err?.details ?? []).map((d) => d.errorCode)];
  if (codes.includes("UNREGISTERED") || status === 404) return "gone";
  if (codes.includes("INVALID_ARGUMENT") && /registration token/i.test(err?.message ?? "")) return "gone";
  if (
    status === 401 ||
    status === 403 ||
    codes.includes("SENDER_ID_MISMATCH") ||
    codes.includes("THIRD_PARTY_AUTH_ERROR")
  ) {
    return "auth";
  }
  return "failed";
}

export interface PushDeps {
  /** Loads the notification and its recipient's browser tokens. */
  payload: (id: string) => Promise<unknown>;
  /** Forgets tokens Firebase no longer knows. */
  dropTokens: (tokens: string[]) => Promise<void>;
  /** Records the run for support. */
  log: (ok: boolean, detail: Record<string, unknown>) => Promise<void>;
  /** Sends one message; returns Firebase's HTTP status and body. */
  send: (message: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;
  /** Same-origin path the notification should open. */
  linkFor: (p: Payload) => string;
}

export interface PushResult {
  state: "off" | "skipped" | "done" | "auth_error";
  sent: number;
  dropped: number;
  failed: number;
}

/** Sends notification [id] to every browser its recipient enabled. */
export async function runPush(id: string, configured: boolean, deps: PushDeps): Promise<PushResult> {
  const result: PushResult = { state: "done", sent: 0, dropped: 0, failed: 0 };
  if (!configured) return { ...result, state: "off" };

  const parsed = payloadSchema.safeParse(await deps.payload(id));
  // Deleted already, read already, inactive recipient, or no browser: nothing to show.
  if (!parsed.success || parsed.data.read || parsed.data.tokens.length === 0) {
    return { ...result, state: "skipped" };
  }

  const link = deps.linkFor(parsed.data);
  const gone: string[] = [];

  for (const token of parsed.data.tokens.slice(0, 10)) {
    let outcome: SendOutcome;
    try {
      const res = await deps.send(fcmWebMessage(token, parsed.data, link));
      outcome = classify(res.status, res.body);
    } catch {
      outcome = "failed";
    }

    if (outcome === "sent") result.sent++;
    else if (outcome === "gone") gone.push(token);
    else if (outcome === "auth") {
      // Wrong key or project: every browser would fail the same way.
      result.state = "auth_error";
      result.failed++;
      break;
    } else result.failed++;
  }

  if (gone.length) {
    await deps.dropTokens(gone);
    result.dropped = gone.length;
  }

  await deps.log(result.state === "done" && result.failed === 0, { id, ...result });
  return result;
}

/**
 * Constant-time comparison of the dispatch secret. Both sides are hashed first
 * so the comparison length never depends on the attacker's input.
 */
export async function secretMatches(given: string | null, expected: string | undefined): Promise<boolean> {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
