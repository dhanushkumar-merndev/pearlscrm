import { describe, expect, it } from "vitest";

import {
  MAX_MASTER_VALUE_LENGTH,
  findExistingByKey,
  normalizeDisplayName,
  normalizeMasterKey,
  shouldOfferCreate,
  validateMasterValue,
} from "@/lib/master-data";

describe("normalizeDisplayName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeDisplayName("  Rhinoplasty  ")).toBe("Rhinoplasty");
  });

  it("collapses runs of whitespace", () => {
    expect(normalizeDisplayName("Primary   Rhinoplasty")).toBe("Primary Rhinoplasty");
  });

  it("preserves the author's capitalization", () => {
    expect(normalizeDisplayName("PRIMARY")).toBe("PRIMARY");
  });
});

describe("normalizeMasterKey", () => {
  it("lowercases the display form", () => {
    expect(normalizeMasterKey("Rhinoplasty")).toBe("rhinoplasty");
  });

  it("maps different casings of the same value to one key", () => {
    expect(normalizeMasterKey("RHINOPLASTY")).toBe(normalizeMasterKey("Rhinoplasty"));
  });

  it("collapses whitespace before lowercasing", () => {
    expect(normalizeMasterKey("  Revision   Rhinoplasty ")).toBe("revision rhinoplasty");
  });

  it("preserves clinically meaningful punctuation", () => {
    expect(normalizeMasterKey("3 Months")).toBe("3 months");
    expect(normalizeMasterKey("A-P")).toBe("a-p");
    expect(normalizeMasterKey("Right 45°")).toBe("right 45°");
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeMasterKey("   ")).toBe("");
  });
});

describe("validateMasterValue", () => {
  it("accepts a trimmed, keyed value", () => {
    const result = validateMasterValue("  Preservation Rhinoplasty ");
    expect(result).toEqual({
      ok: true,
      displayName: "Preservation Rhinoplasty",
      normalizedKey: "preservation rhinoplasty",
    });
  });

  it("rejects blank input", () => {
    expect(validateMasterValue("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects input over the maximum length", () => {
    const result = validateMasterValue("x".repeat(MAX_MASTER_VALUE_LENGTH + 1));
    expect(result).toEqual({ ok: false, reason: "too_long" });
  });

  it("accepts exactly the maximum length", () => {
    expect(validateMasterValue("x".repeat(MAX_MASTER_VALUE_LENGTH)).ok).toBe(true);
  });
});

describe("findExistingByKey", () => {
  const options = [
    { id: "a", normalized_key: "rhinoplasty" },
    { id: "b", normalized_key: "revision rhinoplasty" },
  ];

  it("finds an existing value case-insensitively", () => {
    expect(findExistingByKey(options, "RHINOPLASTY")?.id).toBe("a");
  });

  it("returns undefined for a genuinely new value", () => {
    expect(findExistingByKey(options, "Preservation Rhinoplasty")).toBeUndefined();
  });

  it("returns undefined for blank input", () => {
    expect(findExistingByKey(options, " ")).toBeUndefined();
  });
});

describe("shouldOfferCreate", () => {
  const options = [{ id: "a", normalized_key: "rhinoplasty" }];

  it("offers create only for a valid, new value", () => {
    expect(shouldOfferCreate(options, "Preservation Rhinoplasty")).toBe(true);
    expect(shouldOfferCreate(options, "Rhinoplasty")).toBe(false);
  });

  it("never offers create for blank or overlong input", () => {
    expect(shouldOfferCreate(options, "  ")).toBe(false);
    expect(shouldOfferCreate(options, "x".repeat(MAX_MASTER_VALUE_LENGTH + 1))).toBe(false);
  });
});