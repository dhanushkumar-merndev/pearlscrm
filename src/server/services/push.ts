import "server-only";

import { serverEnv } from "@/lib/env/server";
import { notificationHref } from "@/lib/notification-navigation";
import {
  GOOGLE_TOKEN_URL,
  parseServiceAccount,
  runPush,
  signedAssertion,
  type Payload,
  type PushResult,
  type ServiceAccount,
} from "@/lib/push/fcm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppNotification, VisitType } from "@/lib/types";

/**
 * Delivers one notification as browser push through Firebase Cloud Messaging.
 * Same Firebase project and service account as the Pearl Sales CRM; web only.
 * Best effort: the notification is already in the in-app bell.
 */

// Google access tokens last an hour; keep one per warm Worker instance.
let cachedToken: { token: string; until: number; email: string } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.email === sa.client_email && cachedToken.until > now + 60) {
    return cachedToken.token;
  }

  const res = await fetch(sa.token_uri ?? GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: await signedAssertion(sa, now),
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const out = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !out.access_token) throw new Error(`google token: HTTP ${res.status}`);

  cachedToken = { token: out.access_token, until: now + (out.expires_in ?? 3600), email: sa.client_email };
  return out.access_token;
}

export function pushLinkFor(p: Payload): string {
  if (p.type === "SURGERY_REMINDER" && p.case_id) return `/cases/${p.case_id}?tab=overview`;
  return notificationHref({
    type: p.type,
    case_id: p.case_id ?? null,
    visit_type: (p.visit_type as VisitType | null) ?? null,
    edit_scope: null,
  } as AppNotification);
}

export function pushConfigured(): boolean {
  const env = serverEnv();
  const sa = parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON);
  return Boolean(sa && (env.FCM_PROJECT_ID || sa.project_id));
}

export async function deliverNotificationPush(notificationId: string): Promise<PushResult> {
  const env = serverEnv();
  const account = parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON);
  const projectId = env.FCM_PROJECT_ID || account?.project_id || "";
  const admin = createSupabaseAdminClient();

  return runPush(notificationId, Boolean(account && projectId), {
    async payload(id) {
      const { data, error } = await admin.rpc("push_payload", { p_id: id });
      if (error) throw new Error("push_payload failed");
      return data;
    },
    async dropTokens(tokens) {
      await admin.rpc("push_tokens_drop", { p_tokens: tokens });
    },
    async log(ok, detail) {
      await admin.rpc("push_log_run", { p_ok: ok, p_detail: detail });
    },
    async send(message) {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await accessToken(account!)}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(10_000),
        },
      );
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    linkFor: pushLinkFor,
  });
}
