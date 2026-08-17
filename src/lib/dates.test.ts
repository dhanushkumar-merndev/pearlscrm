import { describe, expect, it } from "vitest";

import { daysBetween, formatClinicDate, formatTimestamp, todayIsoDate } from "@/lib/dates";

describe("formatClinicDate", () => {
  it("formats an ISO date as DD/MM/YYYY", () => {
    expect(formatClinicDate("2026-01-12")).toBe("12/01/2026");
  });

  it("ignores any time component", () => {
    expect(formatClinicDate("2026-03-05T10:00:00Z")).toBe("05/03/2026");
  });

  it("returns an em dash for missing or invalid values", () => {
    expect(formatClinicDate(null)).toBe("—");
    expect(formatClinicDate("")).toBe("—");
    expect(formatClinicDate("not-a-date")).toBe("—");
  });
});

describe("todayIsoDate", () => {
  it("returns the local calendar date as YYYY-MM-DD without a UTC round-trip", () => {
    const iso = todayIsoDate(new Date(2026, 0, 2));
    expect(iso).toBe("2026-01-02");
  });

  it("pads single-digit months and days", () => {
    expect(todayIsoDate(new Date(2026, 10, 5))).toBe("2026-11-05");
  });
});

describe("daysBetween", () => {
  it("counts whole days between two dates", () => {
    expect(daysBetween("2026-01-12", "2026-02-11")).toBe(30);
  });

  it("returns zero for identical dates", () => {
    expect(daysBetween("2026-06-01", "2026-06-01")).toBe(0);
  });

  it("returns a negative value for a date before the start", () => {
    expect(daysBetween("2026-06-01", "2026-05-01")).toBe(-31);
  });

  it("handles the leap day in 2024 without DST shifts", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
  });
});

describe("formatTimestamp", () => {
  it("formats a timestamptz in the viewer's locale", () => {
    // Built from local time so the assertion holds in any timezone.
    const local = new Date(2026, 0, 12, 9, 30).toISOString();
    expect(formatTimestamp(local)).toMatch(/^12\/01\/2026, 09:30$/);
  });

  it("returns an em dash for missing or invalid values", () => {
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp("garbage")).toBe("—");
  });
});