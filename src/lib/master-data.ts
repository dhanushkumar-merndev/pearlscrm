/**
 * Normalization rules for self-learning dropdown values.
 *
 * These mirror `public.normalize_master_key` / `normalize_master_display` in
 * SQL exactly. The database's unique index on `normalized_key` is what actually
 * guarantees no duplicates under concurrency; this module exists so the client
 * can detect an existing match before offering to create one.
 */

export const MAX_MASTER_VALUE_LENGTH = 200;

/** Trim, collapse runs of whitespace, preserve the author's capitalization. */
export function normalizeDisplayName(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/**
 * The de-duplication key: display normalization plus lowercasing.
 * `"  RHINOPLASTY  "` and `"Rhinoplasty"` both key to `"rhinoplasty"`.
 *
 * Clinically meaningful punctuation (hyphens, parentheses, degree signs) is
 * deliberately preserved rather than stripped.
 */
export function normalizeMasterKey(input: string): string {
  return normalizeDisplayName(input).toLowerCase();
}

export type MasterValueValidation =
  | { ok: true; displayName: string; normalizedKey: string }
  | { ok: false; reason: "empty" | "too_long" };

export function validateMasterValue(input: string): MasterValueValidation {
  const displayName = normalizeDisplayName(input ?? "");

  if (displayName === "") return { ok: false, reason: "empty" };
  if (displayName.length > MAX_MASTER_VALUE_LENGTH) return { ok: false, reason: "too_long" };

  return { ok: true, displayName, normalizedKey: normalizeMasterKey(displayName) };
}

type HasKey = { normalized_key: string };

/** Finds an already-known value for the typed text, case-insensitively. */
export function findExistingByKey<T extends HasKey>(options: T[], input: string): T | undefined {
  const key = normalizeMasterKey(input);
  if (!key) return undefined;
  return options.find((option) => option.normalized_key === key);
}

/**
 * Whether the combobox should offer "+ Create ...".
 * Never for blank input, and never when the value already exists.
 */
export function shouldOfferCreate<T extends HasKey>(options: T[], input: string): boolean {
  const validation = validateMasterValue(input);
  if (!validation.ok) return false;
  return findExistingByKey(options, input) === undefined;
}
