import { describe, expect, it } from "vitest";

import { currentAge, fileIdSearchPrefix, formatFileId, normalizeFileIdInput } from "@/lib/file-id";

describe("File IDs", () => {
  it("formats branch code plus four digits minimum", () => {
    expect(formatFileId("BG", 1)).toBe("BG0001");
    expect(formatFileId("kl", 42)).toBe("KL0042");
    expect(formatFileId("SH", 12345)).toBe("SH12345");
  });

  it("normalises what people type", () => {
    expect(normalizeFileIdInput("kl12")).toBe("KL0012");
    expect(normalizeFileIdInput(" KL 0012 ")).toBe("KL0012");
    expect(normalizeFileIdInput("bg-1")).toBe("BG0001");
    expect(normalizeFileIdInput("Priya")).toBeNull();
    expect(normalizeFileIdInput("9845012345")).toBeNull();
  });

  it("builds a search prefix only for code-like input", () => {
    expect(fileIdSearchPrefix("kl1")).toBe("KL1");
    expect(fileIdSearchPrefix("KL")).toBe("KL");
    expect(fileIdSearchPrefix("Priya S")).toBeNull();
  });

  it("ages a recorded age forward", () => {
    expect(currentAge(30, "2024-01-01", new Date("2026-06-01T00:00:00Z"))).toBe(32);
    expect(currentAge(30, "2026-01-01", new Date("2026-06-01T00:00:00Z"))).toBe(30);
    expect(currentAge(null, null)).toBeNull();
  });
});
