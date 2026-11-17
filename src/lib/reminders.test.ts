import { describe, expect, it } from "vitest";

import { surgeryReminderTimes } from "@/lib/reminders";

describe("surgery reminder times (IST)", () => {
  it("is 18:00 the day before and 08:00 on the day", () => {
    const [dayBefore, morning] = surgeryReminderTimes("2026-11-20", new Date("2026-11-01T00:00:00Z"));
    expect(dayBefore.at.toISOString()).toBe("2026-11-19T12:30:00.000Z");
    expect(morning.at.toISOString()).toBe("2026-11-20T02:30:00.000Z");
    expect(dayBefore.skipped || morning.skipped).toBe(false);
  });

  it("skips a time that has already passed (surgery marked late)", () => {
    // 19 Nov, 20:00 IST: the evening-before reminder is gone, the morning one is not.
    const [dayBefore, morning] = surgeryReminderTimes("2026-11-20", new Date("2026-11-19T14:30:00Z"));
    expect(dayBefore.skipped).toBe(true);
    expect(morning.skipped).toBe(false);
  });

  it("crosses month boundaries", () => {
    const [dayBefore] = surgeryReminderTimes("2026-12-01", new Date("2026-11-01T00:00:00Z"));
    expect(dayBefore.at.toISOString()).toBe("2026-11-30T12:30:00.000Z");
  });
});
