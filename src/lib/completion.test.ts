import { describe, expect, it } from "vitest";

import { buildChecklist, completionPercent, followupMaturity, isComplete } from "@/lib/completion";
import type { CaseCompletionFacts } from "@/lib/types";

const COMPLETE_FACTS: CaseCompletionFacts = {
  case_information: true,
  before_images: true,
  before_images_resolved: 6,
  before_images_approved: 6,
  before_images_review: "APPROVED",
  after_images: true,
  after_images_resolved: 6,
  after_images_approved: 6,
  after_images_review: "APPROVED",
  standard_view_count: 6,
  followups: true,
  followup_count: 2,
  case_notes: true,
  consent: true,
  expert_review: true,
};

describe("buildChecklist", () => {
  it("reports every required item and the informational after/follow-up items", () => {
    const items = buildChecklist(COMPLETE_FACTS);

    expect(items).toHaveLength(7);
    expect(items.filter((item) => item.required).map((item) => item.key)).toEqual([
      "case_information",
      "before_images",
      "case_notes",
      "consent",
      "expert_review",
    ]);
  });

  it("describes before-image progress from the resolved and total counts", () => {
    const item = buildChecklist({ ...COMPLETE_FACTS, before_images_resolved: 4 }).find(
      (entry) => entry.key === "before_images",
    );
    expect(item?.detail).toContain("4 of 6");
  });

  it("reports the after phase without gating completion on it", () => {
    const items = buildChecklist({ ...COMPLETE_FACTS, after_images: false, after_images_resolved: 2 });
    const item = items.find((entry) => entry.key === "after_images");

    expect(item?.required).toBe(false);
    expect(item?.detail).toContain("2 of 6");
  });

  it("describes follow-up progress with correct pluralisation", () => {
    const one = buildChecklist({ ...COMPLETE_FACTS, followup_count: 1 }).find(
      (entry) => entry.key === "followups",
    );
    expect(one?.detail).toContain("1 follow-up visit");

    const none = buildChecklist({ ...COMPLETE_FACTS, followup_count: 0 }).find(
      (entry) => entry.key === "followups",
    );
    expect(none?.detail).toContain("No follow-up visits recorded yet");
  });
});

describe("completionPercent", () => {
  it("returns 100 for a fully complete record", () => {
    expect(completionPercent(COMPLETE_FACTS)).toBe(100);
  });

  it("counts the informational items too, so the number reflects fill-in", () => {
    // Missing only the (non-required) follow-up: 6 of 7 items done.
    expect(completionPercent({ ...COMPLETE_FACTS, followups: false, followup_count: 0 })).toBe(86);
  });

  it("returns 0 when nothing is done", () => {
    const empty: CaseCompletionFacts = {
      case_information: false,
      before_images: false,
      before_images_resolved: 0,
      before_images_approved: 6,
      before_images_review: "APPROVED",
      after_images: false,
      after_images_resolved: 0,
      after_images_approved: 6,
      after_images_review: "APPROVED",
      standard_view_count: 6,
      followups: false,
      followup_count: 0,
      case_notes: false,
      consent: false,
      expert_review: false,
    };
    expect(completionPercent(empty)).toBe(0);
  });
});

describe("isComplete", () => {
  it("is true only when every required item is satisfied", () => {
    expect(isComplete(COMPLETE_FACTS)).toBe(true);
  });

  it("is false when consent is missing", () => {
    expect(isComplete({ ...COMPLETE_FACTS, consent: false })).toBe(false);
  });

  it("is false when expert review is missing", () => {
    expect(isComplete({ ...COMPLETE_FACTS, expert_review: false })).toBe(false);
  });

  it("is false when case information is missing", () => {
    expect(isComplete({ ...COMPLETE_FACTS, case_information: false })).toBe(false);
  });

  it("does not gate on the informational follow-up item", () => {
    // A case is never blocked from completion purely by missing follow-ups.
    expect(isComplete({ ...COMPLETE_FACTS, followups: false, followup_count: 0 })).toBe(true);
  });

  it("does not gate on the after-image set, which is often still being collected", () => {
    expect(
      isComplete({ ...COMPLETE_FACTS, after_images: false, after_images_resolved: 0 }),
    ).toBe(true);
  });
});

describe("followupMaturity", () => {
  it("exposes follow-up presence and count as a distinct signal", () => {
    expect(followupMaturity(COMPLETE_FACTS)).toEqual({ hasFollowups: true, count: 2 });
    expect(followupMaturity({ ...COMPLETE_FACTS, followups: false, followup_count: 0 })).toEqual({
      hasFollowups: false,
      count: 0,
    });
  });
});