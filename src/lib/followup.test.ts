import { describe, expect, it } from "vitest";

import { monthsAfterSurgery, suggestFollowupLabel } from "@/lib/followup";

const PRESETS = [
  { display_name: "1 Month", months_after_surgery: 1 },
  { display_name: "3 Months", months_after_surgery: 3 },
  { display_name: "6 Months", months_after_surgery: 6 },
  { display_name: "12 Months", months_after_surgery: 12 },
];

describe("monthsAfterSurgery", () => {
  it("computes a positive interval for a later visit", () => {
    const months = monthsAfterSurgery("2026-01-12", "2026-04-12");
    expect(months).toBeGreaterThan(2.9);
    expect(months).toBeLessThan(3.1);
  });

  it("computes a negative interval for a visit before surgery", () => {
    expect(monthsAfterSurgery("2026-04-12", "2026-01-12")).toBeLessThan(0);
  });
});

describe("suggestFollowupLabel", () => {
  it("labels the surgery date itself as day of surgery", () => {
    expect(suggestFollowupLabel("2026-01-12", "2026-01-12", PRESETS)).toBe("Day of Surgery");
  });

  it("labels early visits in days", () => {
    expect(suggestFollowupLabel("2026-01-12", "2026-01-22", PRESETS)).toBe("10 Days");
  });

  it("snaps to a preset within tolerance", () => {
    // 92 days ≈ 3 months; the nearest preset is 3 Months.
    expect(suggestFollowupLabel("2026-01-12", "2026-04-14", PRESETS)).toBe("3 Months");
  });

  it("names an unusual interval by whole months instead of forcing a preset", () => {
    // ~5 months away from both the 3- and 6-month presets.
    const label = suggestFollowupLabel("2026-01-12", "2026-06-12", PRESETS);
    expect(label).toBe("5 Months");
  });

  it("pluralises the 1-month case correctly", () => {
    const label = suggestFollowupLabel("2026-01-12", "2026-02-12", PRESETS);
    expect(label).toBe("1 Month");
  });

  it("returns Custom for a visit before surgery", () => {
    expect(suggestFollowupLabel("2026-04-12", "2026-01-12", PRESETS)).toBe("Custom");
  });

  it("returns whole years for long intervals", () => {
    const label = suggestFollowupLabel("2024-01-12", "2026-01-12", PRESETS);
    expect(label).toBe("2 Years");
  });

  it("works with no presets configured", () => {
    const label = suggestFollowupLabel("2026-01-12", "2026-04-14", []);
    expect(label).toBe("3 Months");
  });
});