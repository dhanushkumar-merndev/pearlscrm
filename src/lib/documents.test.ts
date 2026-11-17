import { describe, expect, it } from "vitest";

import { buildDocumentKey, isWellFormedDocumentKey, validateDocumentCandidate } from "@/lib/documents";

const P = "8e8a61df-2f3c-4d3e-9d0a-1f2e3d4c5b6a";
const D = "536a43c3-1111-4222-8333-944455556666";

describe("document keys", () => {
  it("builds a UUID-only key under patients/", () => {
    const key = buildDocumentKey(P, D, "application/pdf");
    expect(key).toBe(`patients/${P}/documents/${D}/original.pdf`);
    expect(isWellFormedDocumentKey(key)).toBe(true);
  });

  it("refuses anything that is not a UUID", () => {
    expect(() => buildDocumentKey("KL0001", D, "image/png")).toThrow();
    expect(isWellFormedDocumentKey(`patients/KL0001/documents/${D}/original.pdf`)).toBe(false);
    expect(isWellFormedDocumentKey(`clinical/${P}/${D}/${D}/original.jpg`)).toBe(false);
  });
});

describe("validateDocumentCandidate", () => {
  it("accepts a PDF prescription", () => {
    expect(validateDocumentCandidate("rx.PDF", "application/pdf", 1000)).toEqual({ ok: true, mimeType: "application/pdf" });
  });

  it("rejects other types, mismatched extensions, empty and oversized files", () => {
    expect(validateDocumentCandidate("rx.docx", "application/msword", 10).ok).toBe(false);
    expect(validateDocumentCandidate("rx.png", "application/pdf", 10).ok).toBe(false);
    expect(validateDocumentCandidate("rx.pdf", "application/pdf", 0).ok).toBe(false);
    expect(validateDocumentCandidate("rx.pdf", "application/pdf", 11 * 1024 * 1024).ok).toBe(false);
  });
});
