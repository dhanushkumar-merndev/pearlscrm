import type { ImageSlot } from "@/lib/types";

/**
 * A pending, unsaved change to one clinical view.
 *
 * Nothing leaves the browser while a change sits here: the clinician assembles
 * the whole set locally — all six views, replacements, removals — and one Save
 * applies it. That keeps a half-uploaded visit from ever existing, and gives
 * the administrators a single notification per submission rather than one per
 * photograph.
 */
export type StagedChange =
  | { kind: "upload"; file: File; previewUrl: string }
  | { kind: "remove" }
  | { kind: "unavailable"; reason: string }
  | { kind: "clear-unavailable" };

export type StagedMap = Record<string, StagedChange>;

/** How the slot will read once the staged change is saved. */
export function projectedStatus(
  slot: ImageSlot,
  staged: StagedChange | undefined,
): "UPLOADED" | "MISSING" | "NOT_AVAILABLE" {
  if (staged?.kind === "upload") return "UPLOADED";
  if (staged?.kind === "remove") return "MISSING";
  if (staged?.kind === "unavailable") return "NOT_AVAILABLE";
  if (staged?.kind === "clear-unavailable") {
    return slot.currentVersion ? "UPLOADED" : "MISSING";
  }

  return slot.image?.availability_status ?? "MISSING";
}

/** Views that will be resolved — uploaded or explicitly unavailable — after save. */
export function projectedResolvedCount(slots: ImageSlot[], staged: StagedMap): number {
  return slots.filter((slot) => projectedStatus(slot, staged[slot.viewType.id]) !== "MISSING")
    .length;
}

export function describeStaged(change: StagedChange): string {
  switch (change.kind) {
    case "upload":
      return "New image ready to save";
    case "remove":
      return "Will be removed on save";
    case "unavailable":
      return "Will be marked not available";
    case "clear-unavailable":
      return "Will be returned to awaiting upload";
  }
}
