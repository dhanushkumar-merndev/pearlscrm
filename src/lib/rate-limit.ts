import "server-only";

import { AppError } from "@/lib/errors";

/**
 * Write limits enforced by Cloudflare's distributed Rate Limiting binding.
 *
 * Keys are the authenticated user id plus the operation, never an IP address:
 * clinic staff may share an office network, so an IP-based limit would block
 * unrelated authorised clinicians. The in-memory fallback exists only for
 * local development; production must have the bindings in `wrangler.jsonc`.
 */
export const WRITE_RATE_LIMITS = {
  caseCreate: { binding: "CASE_CREATE_RATE_LIMIT", label: "case creations", limit: 10 },
  followupCreate: { binding: "FOLLOWUP_CREATE_RATE_LIMIT", label: "follow-up creations", limit: 10 },
  userAccessChange: { binding: "USER_ACCESS_RATE_LIMIT", label: "user or access changes", limit: 10 },
} as const;

export type WriteRateLimit = keyof typeof WRITE_RATE_LIMITS;

type RateLimitBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

type RateLimitEnvironment = Record<string, unknown>;

type FallbackBucket = { count: number; resetAt: number };
const localBuckets = new Map<string, FallbackBucket>();

export async function enforceWriteRateLimit(scope: WriteRateLimit, userId: string): Promise<void> {
  const config = WRITE_RATE_LIMITS[scope];
  const key = `${scope}:${userId}`;
  const binding = await getCloudflareBinding(config.binding);

  const allowed = binding
    ? (await binding.limit({ key })).success
    : consumeLocalDevelopmentBucket(key, config.limit);

  if (!allowed) {
    throw new AppError(
      "RATE_LIMITED",
      `Too many ${config.label}. Please wait a minute and try again.`,
    );
  }
}

async function getCloudflareBinding(name: string): Promise<RateLimitBinding | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = getCloudflareContext();
    const binding = (env as RateLimitEnvironment)[name];

    if (isRateLimitBinding(binding)) return binding;

    // A Worker context without the binding means the production configuration
    // is wrong. Fail closed instead of silently shipping without protection.
    if (isCloudflareWorkerRuntime()) {
      throw new Error(`Cloudflare rate-limit binding ${name} is missing.`);
    }
  } catch (error) {
    // `next dev` has no Worker context unless it is started through Wrangler.
    // That local-only path is covered by the small in-memory limiter below.
    if (isCloudflareWorkerRuntime()) throw error;
  }

  return null;
}

function isRateLimitBinding(value: unknown): value is RateLimitBinding {
  return typeof value === "object" && value !== null && "limit" in value &&
    typeof (value as { limit?: unknown }).limit === "function";
}

function isCloudflareWorkerRuntime(): boolean {
  return "WebSocketPair" in globalThis;
}

function consumeLocalDevelopmentBucket(key: string, limit: number): boolean {
  const now = Date.now();
  const current = localBuckets.get(key);

  if (!current || current.resetAt <= now) {
    localBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

/** Test hook for isolated local-rate-limit tests. */
export function __resetLocalRateLimitsForTests(): void {
  localBuckets.clear();
}
