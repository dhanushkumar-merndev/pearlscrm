import "server-only";

import { z } from "zod";

/**
 * Server-only secrets. Importing this module from a Client Component is a build
 * error thanks to `server-only`, which is the guarantee that none of these
 * values can ever be inlined into the browser bundle.
 */
const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

  TIGRIS_ENDPOINT: z.string().url("TIGRIS_ENDPOINT must be a URL"),
  TIGRIS_REGION: z.string().min(1, "TIGRIS_REGION is required"),
  TIGRIS_BUCKET: z.string().min(1, "TIGRIS_BUCKET is required"),
  TIGRIS_ACCESS_KEY_ID: z.string().min(1, "TIGRIS_ACCESS_KEY_ID is required"),
  TIGRIS_SECRET_ACCESS_KEY: z.string().min(1, "TIGRIS_SECRET_ACCESS_KEY is required"),

  /** Seconds a presigned upload URL stays valid. 30 minutes. */
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(1800),
  /** Seconds a presigned read URL stays valid. 30 minutes. */
  READ_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(1800),
  /** Largest clinical image accepted, in bytes. 5 MB. */
  MAX_IMAGE_BYTES: z.coerce.number().int().min(1).default(5 * 1024 * 1024),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    // Message names the variables only — never their values.
    throw new Error(
      `Invalid server environment configuration: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test hook: drops the memoised value so a test can re-read process.env. */
export function resetServerEnvCache() {
  cached = undefined;
}
