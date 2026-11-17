/**
 * Surgery reminder times, mirroring `public.schedule_surgery_reminders`:
 * 18:00 the evening before and 08:00 on the day, in the clinic's timezone
 * (Asia/Kolkata, UTC+05:30, no daylight saving). Used to preview the times in
 * the Mark for Surgery dialog; the database is what actually schedules them.
 */

export const CLINIC_UTC_OFFSET_MINUTES = 330;

function clinicInstant(isoDate: string, hour: number, dayOffset = 0): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d + dayOffset, hour, 0) - CLINIC_UTC_OFFSET_MINUTES * 60_000;
  return new Date(utc);
}

export type ReminderPreview = { kind: "DAY_BEFORE" | "MORNING_OF"; at: Date; skipped: boolean };

export function surgeryReminderTimes(surgeryDate: string, now = new Date()): ReminderPreview[] {
  const dayBefore = clinicInstant(surgeryDate, 18, -1);
  const morning = clinicInstant(surgeryDate, 8);
  return [
    { kind: "DAY_BEFORE", at: dayBefore, skipped: dayBefore <= now },
    { kind: "MORNING_OF", at: morning, skipped: morning <= now },
  ];
}

/** "17/11/2026, 6:00 PM" in clinic time. */
export function formatClinicDateTime(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
}
