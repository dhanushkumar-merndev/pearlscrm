/**
 * Formatting for storage figures.
 *
 * Separate from `formatBytes` in `lib/images`, which is tuned for one clinical
 * photograph and stops at MB. Bucket totals run to GB and beyond.
 */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // Bytes and KB are never fractional in this context; larger units keep one
  // decimal so a change of a few MB is still visible.
  const decimals = unit <= 1 ? 0 : 1;

  return `${value.toFixed(decimals)} ${UNITS[unit]}`;
}

export function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // An unrecognised ISO code must not break the page.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Percentage of a whole, clamped, for a progress or arc value. */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}
