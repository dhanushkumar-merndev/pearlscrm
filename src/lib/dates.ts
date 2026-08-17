/**
 * Date handling.
 *
 * `surgery_date` and `visit_date` are SQL `date` values — calendar days with no
 * time and no zone. Passing them through `new Date(...)` and back is how pure
 * dates silently shift by a day, so these helpers work on the `YYYY-MM-DD`
 * string directly and never involve the runtime's timezone.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;

  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);

  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** `2026-01-12` -> `12/01/2026`. Returns an em dash for a missing date. */
export function formatClinicDate(value: string | null | undefined): string {
  if (!value) return "—";

  const match = ISO_DATE.exec(value.slice(0, 10));
  if (!match) return "—";

  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/** Formats a `timestamptz` for audit/metadata display in the viewer's locale. */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Today as `YYYY-MM-DD` in the *local* calendar, without any UTC round-trip. */
export function todayIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Whole days between two `YYYY-MM-DD` values, computed in UTC to avoid DST. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);

  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new Error("Invalid ISO date");
  }

  return Math.round((to - from) / 86_400_000);
}
