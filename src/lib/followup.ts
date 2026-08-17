import { daysBetween } from "@/lib/dates";

/**
 * Follow-up interval maths.
 *
 * The *dates* are authoritative. The label is presentation metadata: the system
 * suggests one, the clinician may overwrite it, and a visit at 5 months is a
 * perfectly valid record rather than something to be forced into a 6-month slot.
 */

const AVERAGE_DAYS_PER_MONTH = 30.436875;

/** Months elapsed between surgery and a visit, to two decimal places. */
export function monthsAfterSurgery(surgeryDateIso: string, visitDateIso: string): number {
  const days = daysBetween(surgeryDateIso, visitDateIso);
  return Math.round((days / AVERAGE_DAYS_PER_MONTH) * 100) / 100;
}

export type FollowupPreset = {
  display_name: string;
  months_after_surgery: number | null;
};

/**
 * Suggests a label for a visit date.
 *
 * Snaps to a configured preset only when the visit falls within ~18 days of it;
 * otherwise it names the nearest whole month ("5 Months"), which is a real
 * clinical interval rather than a mislabelled preset.
 */
export function suggestFollowupLabel(
  surgeryDateIso: string,
  visitDateIso: string,
  presets: FollowupPreset[] = [],
): string {
  const months = monthsAfterSurgery(surgeryDateIso, visitDateIso);

  if (months < 0) return "Custom";

  const days = daysBetween(surgeryDateIso, visitDateIso);
  if (days < 14) return days <= 1 ? "Day of Surgery" : `${days} Days`;

  const candidates = presets
    .filter((preset): preset is FollowupPreset & { months_after_surgery: number } =>
      typeof preset.months_after_surgery === "number",
    )
    .map((preset) => ({
      preset,
      distanceDays: Math.abs(preset.months_after_surgery * AVERAGE_DAYS_PER_MONTH - days),
    }))
    .sort((a, b) => a.distanceDays - b.distanceDays);

  const nearest = candidates[0];
  if (nearest && nearest.distanceDays <= 18) {
    return nearest.preset.display_name;
  }

  const wholeMonths = Math.round(months);
  if (wholeMonths <= 0) return "Custom";
  if (wholeMonths === 1) return "1 Month";
  if (wholeMonths >= 24 && wholeMonths % 12 === 0) {
    return `${wholeMonths / 12} Years`;
  }

  return `${wholeMonths} Months`;
}
