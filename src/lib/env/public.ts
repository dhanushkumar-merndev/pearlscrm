import { z } from "zod";

/**
 * Environment values that are safe to reach the browser bundle.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, so these must be
 * referenced by their full literal name rather than looked up dynamically.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cached: PublicEnv | undefined;

export function publicEnv(): PublicEnv {
  if (cached) return cached;

  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid public environment configuration: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  cached = parsed.data;
  return cached;
}

/**
 * Firebase web app config for browser push (same Firebase project as the
 * Pearl Sales CRM). These values are public by design: Firebase identifies the
 * web app with them, and sending a push still needs the server-only service
 * account. Web only, so there is no Android config here.
 */
export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
};

const firebaseWebSchema = z.object({
  apiKey: z.string().min(1),
  authDomain: z.string().min(1),
  projectId: z.string().min(1),
  messagingSenderId: z.string().min(1),
  appId: z.string().min(1),
  vapidKey: z.string().min(1),
});

/** Returns null when any value is missing, so push stays off instead of failing. */
export function firebaseWebConfig(): FirebaseWebConfig | null {
  const parsed = firebaseWebSchema.safeParse({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
  });
  return parsed.success ? parsed.data : null;
}
