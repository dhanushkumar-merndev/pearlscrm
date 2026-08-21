import { describe, expect, it } from "vitest";

import {
  projectedResolvedCount,
  projectedStatus,
  type StagedMap,
} from "@/components/clinical-images/staged-changes";
import type { ImageSlot } from "@/lib/types";

function slot(id: string, saved: Partial<ImageSlot["image"]> | null = null): ImageSlot {
  return {
    viewType: {
      id,
      code: id.toUpperCase(),
      display_name: id,
      sort_order: 0,
      is_standard: true,
      is_active: true,
    },
    image: saved
      ? ({
          id: `image-${id}`,
          case_id: "case",
          visit_id: "visit",
          view_type_id: id,
          availability_status: "MISSING",
          current_version_id: null,
          not_available_reason: null,
          not_available_by: null,
          not_available_at: null,
          created_at: "",
          updated_at: "",
          ...saved,
        } as ImageSlot["image"])
      : null,
    currentVersion: saved?.current_version_id
      ? ({ id: saved.current_version_id } as ImageSlot["currentVersion"])
      : null,
    uploadedByName: null,
  };
}

describe("projectedStatus", () => {
  it("falls back to the saved status when nothing is staged", () => {
    expect(projectedStatus(slot("front", { availability_status: "NOT_AVAILABLE" }), undefined)).toBe(
      "NOT_AVAILABLE",
    );
    expect(projectedStatus(slot("front"), undefined)).toBe("MISSING");
  });

  it("reads a staged file as uploaded before it has been sent", () => {
    const staged = {
      kind: "upload" as const,
      file: new File([""], "front.jpg"),
      previewUrl: "blob:preview",
    };

    expect(projectedStatus(slot("front"), staged)).toBe("UPLOADED");
  });

  it("reads a staged removal as an empty slot", () => {
    const saved = slot("front", {
      availability_status: "UPLOADED",
      current_version_id: "version-1",
    });

    expect(projectedStatus(saved, { kind: "remove" })).toBe("MISSING");
  });

  it("returns a cleared 'not available' slot to whatever it actually holds", () => {
    const withImage = slot("front", {
      availability_status: "NOT_AVAILABLE",
      current_version_id: "version-1",
    });
    const withoutImage = slot("base", { availability_status: "NOT_AVAILABLE" });

    expect(projectedStatus(withImage, { kind: "clear-unavailable" })).toBe("UPLOADED");
    expect(projectedStatus(withoutImage, { kind: "clear-unavailable" })).toBe("MISSING");
  });
});

describe("projectedResolvedCount", () => {
  it("counts uploaded and explicitly unavailable views, staged changes included", () => {
    const slots = [
      slot("front", { availability_status: "UPLOADED", current_version_id: "v1" }),
      slot("base", { availability_status: "NOT_AVAILABLE" }),
      slot("left"),
      slot("right"),
    ];

    const staged: StagedMap = {
      left: { kind: "upload", file: new File([""], "left.jpg"), previewUrl: "blob:left" },
      front: { kind: "remove" },
    };

    // front is staged for removal, base stays unavailable, left is newly staged.
    expect(projectedResolvedCount(slots, staged)).toBe(2);
  });
});
