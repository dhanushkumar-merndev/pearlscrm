import { describe, expect, it } from "vitest";

import {
  DEFAULT_CASE_PADDING,
  DEFAULT_CASE_PREFIX,
  caseNumberSearchPatterns,
  formatCaseNumber,
  parseCaseNumber,
} from "@/lib/case-number";

describe("formatCaseNumber", () => {
  it("formats the first case with the default prefix and padding", () => {
    expect(formatCaseNumber(1)).toBe("RH-0001");
  });

  it("zero-pads to four digits minimum", () => {
    expect(formatCaseNumber(28)).toBe("RH-0028");
    expect(formatCaseNumber(1245)).toBe("RH-1245");
  });

  it("never truncates when the sequence overflows the padding", () => {
    expect(formatCaseNumber(10000)).toBe("RH-10000");
  });

  it("supports a configurable prefix and padding", () => {
    expect(formatCaseNumber(7, { prefix: "PL-", padding: 3 })).toBe("PL-007");
  });

  it("rejects non-positive or non-integer sequences", () => {
    expect(() => formatCaseNumber(0)).toThrow();
    expect(() => formatCaseNumber(-1)).toThrow();
    expect(() => formatCaseNumber(1.5)).toThrow();
  });

  it("rejects invalid padding", () => {
    expect(() => formatCaseNumber(1, { padding: 0 })).toThrow();
    expect(() => formatCaseNumber(1, { padding: 13 })).toThrow();
  });
});

describe("parseCaseNumber", () => {
  it("parses a plain RH number", () => {
    expect(parseCaseNumber("RH-0028")).toBe(28);
  });

  it("accepts lower case and surrounding whitespace", () => {
    expect(parseCaseNumber("  rh-28 ")).toBe(28);
  });

  it("returns null when the prefix is missing or the tail is not digits", () => {
    expect(parseCaseNumber("28")).toBeNull();
    expect(parseCaseNumber("RH-X")).toBeNull();
    expect(parseCaseNumber("")).toBeNull();
  });
});

describe("caseNumberSearchPatterns", () => {
  it("finds a bare number, a partial case number and a fully formatted one", () => {
    const patterns = caseNumberSearchPatterns("28");
    expect(patterns).toContain("%28%");
    expect(patterns).toContain("%RH-0028%");
    expect(patterns).toContain("RH-%28%");
  });

  it("returns a single pattern for free text", () => {
    expect(caseNumberSearchPatterns("rhino")).toEqual(["%rhino%"]);
  });

  it("returns no patterns for blank input", () => {
    expect(caseNumberSearchPatterns("   ")).toEqual([]);
  });

  it("uses the configured prefix", () => {
    expect(caseNumberSearchPatterns("7", { prefix: "PL-" })).toContain("%PL-0007%");
  });

  it("exposes the default constants", () => {
    expect(DEFAULT_CASE_PREFIX).toBe("RH-");
    expect(DEFAULT_CASE_PADDING).toBe(4);
  });
});
