"use client";

import { firebaseWebConfig } from "@/lib/env/public";
import { registerPushToken, unregisterPushToken } from "@/server/actions/push";

/**
 * Browser side of web push: asks permission, registers our service worker,
 * gets this browser's FCM token (same Firebase project as the Sales CRM, web
 * app only) and hands it to the server. The Firebase SDK is imported lazily so
 * pages that never touch push do not download it.
 */

const SW_PATH = "/firebase-messaging-sw.js";
const TOKEN_KEY = "pearl.push.token";

export type PushState = "unsupported" | "unconfigured" | "denied" | "enabled" | "disabled";

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the server still has the token; we just cannot remember it here.
  }
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function currentPushState(): PushState {
  if (!pushSupported()) return "unsupported";
  if (!firebaseWebConfig()) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && readStoredToken() ? "enabled" : "disabled";
}

async function messagingToken(): Promise<string> {
  const config = firebaseWebConfig();
  if (!config) throw new Error("Push notifications are not configured.");

  const [{ initializeApp, getApps }, { getMessaging, getToken, isSupported }] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);

  if (!(await isSupported())) throw new Error("This browser does not support push notifications.");

  const app =
    getApps().find((a) => a.name === "pearl-clinic") ??
    initializeApp(
      {
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
      },
      "pearl-clinic",
    );

  const registration = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
  await navigator.serviceWorker.ready;

  return getToken(getMessaging(app), {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration,
  });
}

/** Turns push on for this browser. Must be called from a user gesture. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (!firebaseWebConfig()) return "unconfigured";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "disabled";

  const token = await messagingToken();
  const result = await registerPushToken({ token, userAgent: navigator.userAgent.slice(0, 200) });
  if (!result.ok) throw new Error(result.error.message);

  storeToken(token);
  return "enabled";
}

/** Turns push off for this browser (also called on sign-out). Never throws. */
export async function disablePush(): Promise<PushState> {
  const token = readStoredToken();
  storeToken(null);

  if (token) {
    await unregisterPushToken({ token }).catch(() => undefined);
    try {
      const { getApps } = await import("firebase/app");
      const { getMessaging, deleteToken } = await import("firebase/messaging");
      const app = getApps().find((a) => a.name === "pearl-clinic");
      if (app) await deleteToken(getMessaging(app));
    } catch {
      // The server row is gone already; a stale browser token is harmless.
    }
  }

  return currentPushState();
}

/** Re-sends an existing token so `last_seen_at` stays fresh and rotations are picked up. */
export async function refreshPushToken(): Promise<void> {
  if (currentPushState() !== "enabled") return;
  try {
    const token = await messagingToken();
    if (token !== readStoredToken()) storeToken(token);
    await registerPushToken({ token, userAgent: navigator.userAgent.slice(0, 200) });
  } catch {
    // Best effort.
  }
}
