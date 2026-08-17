/**
 * Case number presentation.
 *
 * The authoritative sequence lives in PostgreSQL (`case_number_seq` +
 * `format_case_number`). This module mirrors the same formatting rules so the
 * UI can render previews and parse user-typed search input — it never
 * *allocates* a number.
 */

export const DEFAULT_CASE_PREFIX = "RH-";
export const DEFAULT_CASE_PADDING = 4;

export type CaseNumberConfig = {
  prefix?: string;
  padding?: number;
};

/**
 * Formats a sequence value the same way `public.format_case_number` does:
 * zero-padded to at least `padding` digits, never truncated when it overflows.
 */
export function formatCaseNumber(sequence: number, config: CaseNumberConfig = {}): string {
  const prefix = config.prefix ?? DEFAULT_CASE_PREFIX;
  const padding = config.padding ?? DEFAULT_CASE_PADDING;

  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Case sequence must be a positive integer");
  }
  if (!Number.isInteger(padding) || padding < 1 || padding > 12) {
    throw new Error("Case number padding must be between 1 and 12");
  }

  return `${prefix}${String(sequence).padStart(padding, "0")}`;
}

/** Extracts the numeric part of a case number, or null when it doesn't match. */
export function parseCaseNumber(value: string, config: CaseNumberConfig = {}): number | null {
  const prefix = config.prefix ?? DEFAULT_CASE_PREFIX;
  const trimmed = value.trim().toUpperCase();

  if (!trimmed.startsWith(prefix.toUpperCase())) return null;

  const digits = trimmed.slice(prefix.length);
  if (!/^\d+$/.test(digits)) return null;

  return Number.parseInt(digits, 10);
}

/**
 * Widens a user's search term so `28`, `RH-28` and `rh-0028` all find RH-0028.
 * Returns the set of `ILIKE` patterns to try.
 */
export function caseNumberSearchPatterns(term: string, config: CaseNumberConfig = {}): string[] {
  const prefix = config.prefix ?? DEFAULT_CASE_PREFIX;
  const trimmed = term.trim();
  if (!trimmed) return [];

  const patterns = new Set<string>([`%${trimmed}%`]);

  if (/^\d+$/.test(trimmed)) {
    const sequence = Number.parseInt(trimmed, 10);
    if (sequence >= 1) {
      patterns.add(`%${formatCaseNumber(sequence, config)}%`);
    }
    patterns.add(`${prefix}%${trimmed}%`);
  }

  return [...patterns];
}
