import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

import { serverEnv } from "@/lib/env/server";

let cached: S3Client | undefined;

/**
 * S3-compatible client for the PRIVATE Tigris bucket.
 *
 * Credentials never leave the server: the browser only ever receives
 * short-lived presigned URLs produced by `lib/tigris/presign`.
 */
export function tigrisClient(): S3Client {
  if (cached) return cached;

  const env = serverEnv();

  cached = new S3Client({
    region: env.TIGRIS_REGION,
    endpoint: env.TIGRIS_ENDPOINT,
    // Tigris expects virtual-hosted style addressing. A local S3 emulator on
    // localhost/127.0.0.1 (development only) cannot use bucket subdomains.
    forcePathStyle: isLocalEndpoint(env.TIGRIS_ENDPOINT),
    credentials: {
      accessKeyId: env.TIGRIS_ACCESS_KEY_ID,
      secretAccessKey: env.TIGRIS_SECRET_ACCESS_KEY,
    },
  });

  return cached;
}

function isLocalEndpoint(endpoint: string): boolean {
  const host = new URL(endpoint).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export function tigrisBucket(): string {
  return serverEnv().TIGRIS_BUCKET;
}

/** Test hook so a suite can swap in a stub client. */
export function __setTigrisClientForTests(client: S3Client | undefined) {
  cached = client;
}
