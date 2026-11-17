/**
 * Branch File IDs: branch code + at least four digits (BG0001, KL0042).
 *
 * The number is allocated by `public.next_file_id` under a row lock; these
 * helpers only format and recognise what people type into search.
 */

export const FILE_ID_PATTERN = /^[A-Z]{2,4}\d{4,}$/;

export function formatFileId(code: string, seq: number): string {
  return `${code.toUpperCase()}${String(seq).padStart(4, "0")}`;
}

/**
 * Turns loose input into a File ID when it looks like one: "kl12", "KL 12",
 * "kl-0012" → "KL0012". Returns null for anything that is not code + digits.
 */
export function normalizeFileIdInput(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[\s-]+/g, "");
  const match = /^([A-Z]{2,4})(\d{1,9})$/.exec(compact);
  if (!match) return null;
  return formatFileId(match[1], Number(match[2]));
}

/**
 * Prefix for a partial File ID search ("KL" → "KL", "KL1" → "KL1"): used for
 * `ilike 'KL1%'` so typing narrows as you go without padding too early.
 */
export function fileIdSearchPrefix(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[\s-]+/g, "");
  return /^[A-Z]{2,4}\d*$/.test(compact) ? compact : null;
}

/** Age today from the age recorded on a date (people do not give a DOB at the desk). */
export function currentAge(ageYears: number | null, recordedOn: string | null, today = new Date()): number | null {
  if (ageYears === null || recordedOn === null) return ageYears;
  const recorded = new Date(`${recordedOn}T00:00:00Z`);
  const years = Math.floor((today.getTime() - recorded.getTime()) / (365.25 * 24 * 3600 * 1000));
  return ageYears + Math.max(0, years);
}
