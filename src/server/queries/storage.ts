import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AppError, logServerError } from "@/lib/errors";
import { serverEnv } from "@/lib/env/server";
import { listBucketObjects } from "@/lib/tigris/presign";
import { requirePermission } from "@/server/auth/session";
import { getStoragePlan, TIGRIS_CONSOLE_URL } from "@/server/services/app-settings";

/**
 * What the Tigris bucket actually holds.
 *
 * The figures here are read from object storage itself — a `ListObjectsV2` walk
 * of the private bucket — not inferred from the database. That distinction is
 * the point of the screen: the two can legitimately disagree, and an object
 * that exists in Tigris while no case points at it is exactly the condition
 * worth surfacing.
 *
 * The database is consulted for two narrow purposes only:
 *
 *   - the set of `object_key`s the clinical record references, so a stored
 *     object can be classified as recorded or orphaned;
 *   - case numbers, so the per-case table reads as `RH-0004` rather than a UUID.
 *
 * What this cannot do is report a Tigris plan, invoice or balance: Tigris
 * exposes no billing or plan endpoint on its S3-compatible API, so there is
 * nothing to read. The allowance and the rate are settings an administrator
 * edits (see `app-settings`), defaulting to Tigris's published free tier, and
 * the cost shown is an estimate on the overflow — never presented as an
 * invoice. The Tigris console stays the authority, and the screen links to it.
 */

export type StorageSegment = {
  key: "current" | "superseded" | "avatars" | "orphaned" | "other";
  label: string;
  description: string;
  bytes: number;
  objects: number;
};

export type CaseStorageRow = {
  caseId: string;
  caseNumber: string;
  images: number;
  bytes: number;
  lastUploadedAt: string | null;
};

export type StorageUsage = {
  bucket: string;
  region: string;
  segments: StorageSegment[];
  totalBytes: number;
  totalObjects: number;
  /** Largest single object in the bucket, for spotting an outlier. */
  largestObjectBytes: number;
  newestObjectAt: string | null;
  oldestObjectAt: string | null;
  quotaBytes: number;
  costPerGbMonth: number;
  currency: string;
  /** Where the allowance and rate came from. */
  planSource: "configured" | "environment" | "default";
  planUpdatedAt: string | null;
  /** Bytes covered by the allowance. */
  includedBytes: number;
  /** Bytes over the allowance — the only ones that cost anything. */
  billableBytes: number;
  /** Estimated monthly charge on `billableBytes` alone. */
  estimatedMonthlyCost: number;
  /** Bytes still free within the allowance. */
  availableBytes: number;
  consoleUrl: string;
  cases: CaseStorageRow[];
  casesTruncated: boolean;
  /** True when the bucket walk stopped at the cap — totals are a lower bound. */
  listingTruncated: boolean;
  measuredAt: string;
};

const BYTES_PER_GB = 1024 ** 3;
const CASE_ROW_LIMIT = 100;
const MAX_OBJECTS = 20_000;

const CLINICAL_KEY = /^clinical\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/original\.(jpg|png)$/i;
const AVATAR_KEY = /^avatars\//;

type VersionKey = { object_key: string; superseded_at: string | null };

export async function getStorageUsage(): Promise<StorageUsage> {
  await requirePermission("user:manage");

  const env = serverEnv();
  const plan = await getStoragePlan();

  const listing = await listBucketObjects({ maxObjects: MAX_OBJECTS }).catch((cause) => {
    logServerError(cause, "storage:list");
    throw new AppError("INTERNAL", "Secure storage could not be reached.");
  });

  // Classification only — the object metadata itself comes from Tigris.
  const { current, superseded } = await loadRecordedKeys();

  let currentBytes = 0;
  let currentObjects = 0;
  let supersededBytes = 0;
  let supersededObjects = 0;
  let avatarBytes = 0;
  let avatarObjects = 0;
  let orphanBytes = 0;
  let orphanObjects = 0;
  let otherBytes = 0;
  let otherObjects = 0;

  let largestObjectBytes = 0;
  let newest: string | null = null;
  let oldest: string | null = null;

  const perCase = new Map<string, { images: number; bytes: number; last: string | null }>();

  for (const object of listing.objects) {
    largestObjectBytes = Math.max(largestObjectBytes, object.size);

    if (object.lastModified) {
      if (!newest || object.lastModified > newest) newest = object.lastModified;
      if (!oldest || object.lastModified < oldest) oldest = object.lastModified;
    }

    if (AVATAR_KEY.test(object.key)) {
      avatarBytes += object.size;
      avatarObjects += 1;
      continue;
    }

    const match = CLINICAL_KEY.exec(object.key);

    if (!match) {
      // Anything the application did not write. Counted rather than ignored, so
      // the totals always add up to the bucket.
      otherBytes += object.size;
      otherObjects += 1;
      continue;
    }

    const caseId = match[1].toLowerCase();
    const entry = perCase.get(caseId) ?? { images: 0, bytes: 0, last: null };
    entry.images += 1;
    entry.bytes += object.size;
    if (object.lastModified && (!entry.last || object.lastModified > entry.last)) {
      entry.last = object.lastModified;
    }
    perCase.set(caseId, entry);

    if (current.has(object.key)) {
      currentBytes += object.size;
      currentObjects += 1;
    } else if (superseded.has(object.key)) {
      supersededBytes += object.size;
      supersededObjects += 1;
    } else {
      orphanBytes += object.size;
      orphanObjects += 1;
    }
  }

  const segments = ([
    {
      key: "current",
      label: "Current images",
      description: "The original a case points at today.",
      bytes: currentBytes,
      objects: currentObjects,
    },
    {
      key: "superseded",
      label: "Replaced originals",
      description: "Retained history. A clinical original is never deleted.",
      bytes: supersededBytes,
      objects: supersededObjects,
    },
    {
      key: "avatars",
      label: "Profile photos",
      description: "One per user, replaced rather than versioned.",
      bytes: avatarBytes,
      objects: avatarObjects,
    },
    {
      key: "orphaned",
      label: "Unrecorded objects",
      description: "In the bucket but not referenced by any case. Reclaimable below.",
      bytes: orphanBytes,
      objects: orphanObjects,
    },
    {
      key: "other",
      label: "Unrecognised keys",
      description: "Objects this application did not write.",
      bytes: otherBytes,
      objects: otherObjects,
    },
  ] as StorageSegment[]).filter((segment) => segment.objects > 0 || segment.key === "current");

  const totalBytes = listing.objects.reduce((sum, object) => sum + object.size, 0);
  const totalObjects = listing.objects.length;

  const caseNumbers = await lookupCaseNumbers([...perCase.keys()]);

  const cases: CaseStorageRow[] = [...perCase.entries()]
    .map(([caseId, entry]) => ({
      caseId,
      caseNumber: caseNumbers.get(caseId) ?? "Unknown case",
      images: entry.images,
      bytes: entry.bytes,
      lastUploadedAt: entry.last,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  // Only the overflow is billed: everything inside the allowance is already
  // paid for, so charging the whole figure would overstate the cost several
  // times over on a clinic that is comfortably inside its plan.
  const includedBytes = Math.min(totalBytes, plan.quotaBytes);
  const billableBytes = Math.max(0, totalBytes - plan.quotaBytes);

  return {
    bucket: env.TIGRIS_BUCKET,
    region: env.TIGRIS_REGION,
    segments,
    totalBytes,
    totalObjects,
    largestObjectBytes,
    newestObjectAt: newest,
    oldestObjectAt: oldest,
    quotaBytes: plan.quotaBytes,
    costPerGbMonth: plan.costPerGbMonth,
    currency: plan.currency,
    planSource: plan.source,
    planUpdatedAt: plan.updatedAt,
    includedBytes,
    billableBytes,
    estimatedMonthlyCost: (billableBytes / BYTES_PER_GB) * plan.costPerGbMonth,
    availableBytes: Math.max(0, plan.quotaBytes - totalBytes),
    consoleUrl: TIGRIS_CONSOLE_URL,
    cases: cases.slice(0, CASE_ROW_LIMIT),
    casesTruncated: cases.length > CASE_ROW_LIMIT,
    listingTruncated: listing.truncated,
    measuredAt: new Date().toISOString(),
  };
}

/**
 * The object keys the clinical record references, split by whether they are
 * still current.
 *
 * Only the key and the supersede flag are read — no clinical content — and the
 * set is what turns "an object exists" into "an object nothing points at".
 */
async function loadRecordedKeys(): Promise<{ current: Set<string>; superseded: Set<string> }> {
  const admin = createSupabaseAdminClient();
  const current = new Set<string>();
  const superseded = new Set<string>();

  const pageSize = 1000;

  for (let page = 0; page * pageSize < MAX_OBJECTS; page += 1) {
    const from = page * pageSize;

    const { data, error } = await admin
      .from("clinical_image_versions")
      .select("object_key, superseded_at")
      .order("uploaded_at", { ascending: true })
      .range(from, from + pageSize - 1)
      .returns<VersionKey[]>();

    if (error) throw new AppError("INTERNAL", "Could not read the clinical image index.");

    const rows = data ?? [];
    for (const row of rows) {
      (row.superseded_at ? superseded : current).add(row.object_key);
    }

    if (rows.length < pageSize) break;
  }

  return { current, superseded };
}

async function lookupCaseNumbers(caseIds: string[]): Promise<Map<string, string>> {
  if (caseIds.length === 0) return new Map();

  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("cases")
    .select("id, case_number")
    .in("id", caseIds)
    .returns<{ id: string; case_number: string }[]>();

  return new Map((data ?? []).map((row) => [row.id.toLowerCase(), row.case_number]));
}
