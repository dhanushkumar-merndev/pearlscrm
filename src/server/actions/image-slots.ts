"use server";

import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { getImageVersionHistory, getVisitImageSlots } from "@/server/queries/cases";
import { actionResult, type ActionResult } from "@/server/actions/result";
import type { ClinicalImageVersion, ImageSlot } from "@/lib/types";

/**
 * Read actions for the image grid.
 *
 * Object keys are stripped before anything crosses to the client: the browser
 * addresses images by their database id and asks for a fresh signed URL when it
 * needs one.
 */

export async function getVisitSlots(input: {
  visitId: string;
}): Promise<ActionResult<ImageSlot[]>> {
  return actionResult(async () => {
    await requireUser();
    const visitId = z.string().uuid().parse(input.visitId);

    const slots = await getVisitImageSlots(visitId);

    return slots.map((slot) => ({
      ...slot,
      currentVersion: slot.currentVersion ? stripObjectKey(slot.currentVersion) : null,
    }));
  });
}

export type ImageHistoryEntry = Omit<ClinicalImageVersion, "object_key" | "bucket"> & {
  uploaded_by_name: string | null;
};

export async function getImageHistory(input: {
  clinicalImageId: string;
}): Promise<ActionResult<ImageHistoryEntry[]>> {
  return actionResult(async () => {
    await requireUser();
    const clinicalImageId = z.string().uuid().parse(input.clinicalImageId);

    const versions = await getImageVersionHistory(clinicalImageId);

    return versions.map(({ object_key: _key, bucket: _bucket, ...rest }) => rest);
  });
}

/** Replaces the storage location with a placeholder the client never uses. */
function stripObjectKey(version: ClinicalImageVersion): ClinicalImageVersion {
  return { ...version, object_key: "", bucket: "" };
}
