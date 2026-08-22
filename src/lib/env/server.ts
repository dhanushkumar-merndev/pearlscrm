import "server-only";

import { z } from "zod";

/**
 * Server-only secrets. Importing this module from a Client Component is a build
 * error thanks to `server-only`, which is the guarantee that none of these
 * values can ever be inlined into the browser bundle.
 */
/**
 * Treats an unset variable and an empty one alike.
 *
 * `.env` files carry `NAME=` placeholders for optional settings, and an empty
 * string is not `undefined` — without this, leaving a placeholder in place
 * would coerce to 0 and fail validation at boot.
 */
const optionalNumber = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (value === "" || value === undefined ? undefined : value), schema.optional());

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
  /** Largest profile photo accepted, in bytes. 2 MB. */
  MAX_AVATAR_BYTES: z.coerce.number().int().min(1).default(2 * 1024 * 1024),
  /** Avatar reads may be signed for up to seven days (the SigV4 maximum). */
  AVATAR_READ_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(604800).default(604800),

  /**
   * Storage allowance for the bucket, in bytes.
   *
   * Tigris exposes no plan or billing endpoint over its S3 API, so the app
   * cannot discover the allowance for itself. Set this to whatever the plan
   * provides and the Storage screen will show usage against it; leave it unset
   * and the screen reports usage alone rather than inventing a ceiling.
   */
  TIGRIS_STORAGE_QUOTA_BYTES: optionalNumber(z.coerce.number().int().min(1)) as z.ZodType<
    number | undefined
  >,
  /**
   * Storage rate in your billing currency per GB per month, for the estimate on
   * the Storage screen. Unset means no estimate is shown — a made-up figure on
   * a clinical system is worse than none.
   */
  TIGRIS_STORAGE_COST_PER_GB_MONTH: optionalNumber(z.coerce.number().min(0)) as z.ZodType<
    number | undefined
  >,
  /** ISO 4217 code used to format that estimate. */
  TIGRIS_STORAGE_COST_CURRENCY: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.string().length(3).default("USD"),
  ) as z.ZodType<string>,
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
