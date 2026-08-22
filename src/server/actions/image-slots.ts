"use server";

import { z } from "zod";

import { requireUser } from "@/server/auth/session";
import { getImageVersionHistory, getVisitImageSlots } from "@/server/queries/cases";
import { resolveEditAccess } from "@/server/services/edit-access";
import { reconcileVisitUploads } from "@/server/services/upload-reconciliation";
import { actionResult, type ActionResult } from "@/server/actions/result";
import type { ClinicalImageVersion, EditAccess, ImageSlot } from "@/lib/types";

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

/**
 * The Before/After grid needs slots and the caller's edit state together.
 * Returning them from one authenticated action avoids two serial HTTP/action
 * round trips every time a visit panel opens.
 */
export async function getVisitImagePanelData(input: {
  caseId: string;
  visitId: string;
}): Promise<ActionResult<{ slots: ImageSlot[]; access: EditAccess }>> {
  return actionResult(async () => {
    const user = await requireUser();
    const caseId = z.string().uuid().parse(input.caseId);
    const visitId = z.string().uuid().parse(input.visitId);

    // An upload whose `finalize` never arrived leaves bytes in storage that
    // nothing points at. Healing it here means the next person to open the case
    // sees the image, rather than the loss going unnoticed until someone reads
    // the orphan count. It can never fail the panel: errors are logged inside.
    await reconcileVisitUploads({ visitId, actorId: user.id }).catch(() => undefined);

    const [slots, access] = await Promise.all([
      getVisitImageSlots(visitId),
      resolveEditAccess(user, { caseId, scope: "VISIT_IMAGES", visitId }),
    ]);

    return {
      slots: slots.map((slot) => ({
        ...slot,
        currentVersion: slot.currentVersion ? stripObjectKey(slot.currentVersion) : null,
      })),
      access,
    };
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

    return versions.map((version) => {
      const { object_key, bucket, ...rest } = version;
      // The storage location is deliberately never sent to the client.
      void object_key;
      void bucket;
      return rest;
    });
  });
}

/** Replaces the storage location with a placeholder the client never uses. */
function stripObjectKey(version: ClinicalImageVersion): ClinicalImageVersion {
  return { ...version, object_key: "", bucket: "" };
}
