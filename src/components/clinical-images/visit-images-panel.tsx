"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Images,
  Lock,
  Pencil,
  RefreshCw,
  Save,
  ShieldCheck,
  ShieldQuestion,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { RequestEditDialog } from "@/components/cases/request-edit-dialog";
import { ImageSlotCard } from "@/components/clinical-images/image-slot-card";
import { ImageViewerDialog } from "@/components/clinical-images/image-viewer-dialog";
import {
  projectedResolvedCount,
  type StagedChange,
  type StagedMap,
} from "@/components/clinical-images/staged-changes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useRealtime } from "@/hooks/use-realtime";
import { getCached, invalidateCached, setCached } from "@/lib/client-cache";
import { formatClinicDate, formatTimestamp } from "@/lib/dates";
import { formatBytes } from "@/lib/images";
import { can } from "@/lib/permissions";
import { uploadClinicalImage } from "@/lib/upload-client";
import { getVisitSlots } from "@/server/actions/image-slots";
import { clearSlotUnavailable, markSlotUnavailable, removeSlotImage } from "@/server/actions/images";
import { getEditAccess } from "@/server/actions/edit-requests";
import { submitVisitImages } from "@/server/actions/visits";
import type { CaseVisit, EditAccess, ImageSlot, ImageViewType, RoleCode } from "@/lib/types";

/** Three concurrent direct uploads are fast without saturating clinic networks. */
const MAX_CONCURRENT_IMAGE_SAVES = 3;

/**
 * The standard clinical view grid for one visit, as an editable set.
 *
 * The clinician assembles the whole set locally — every view they have, plus
 * any removals or "not available" marks — and one Save applies it: each file
 * uploads directly to storage, then a single submission closes the visit,
 * spends any approval that authorized the edit, and notifies the
 * administrators once.
 *
 * A submitted set is locked. Reopening it needs an administrator's approval,
 * which the server enforces regardless of what this component renders.
 */
export function VisitImagesPanel({
  caseId,
  visit,
  viewTypes,
  role,
  maxImageBytes,
  readOnly = false,
}: {
  caseId: string;
  visit: CaseVisit;
  viewTypes: ImageViewType[];
  role: RoleCode;
  maxImageBytes: number;
  readOnly?: boolean;
}) {
  const router = useRouter();

  const [slots, setSlots] = useState<ImageSlot[] | null>(null);
  const [access, setAccess] = useState<EditAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const [editing, setEditing] = useState(false);
  const [staged, setStaged] = useState<StagedMap>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  // Object URLs are revoked explicitly; a ref keeps them reachable from the
  // unmount cleanup without re-running it on every staging change.
  const previewUrls = useRef(new Set<string>());

  const mayUpload = !readOnly && can(role, "image:upload");
  const mayMark = !readOnly && can(role, "image:mark_unavailable");
  const mayRequest = !readOnly && can(role, "edit_request:create");

  const cacheKey = `visit:${visit.id}`;

  /**
   * Reads through an in-memory cache so switching between Before, After and the
   * follow-up tabs does not refetch what was just on screen. The cache is
   * dropped whenever this visit changes — on save, and on a realtime event — so
   * it can never serve data the database has moved past, and a hard refresh
   * always starts empty.
   */
  const load = useCallback(async (options: { fresh?: boolean } = {}) => {
    setError(null);

    if (options.fresh) invalidateCached(cacheKey);

    const cached = getCached<{ slots: ImageSlot[]; access: EditAccess }>(cacheKey);

    if (cached) {
      setSlots(cached.slots);
      setAccess(cached.access);
      setEditing((current) => current || (!cached.access.locked && mayUpload));
      return;
    }

    const [slotsResult, accessResult] = await Promise.all([
      getVisitSlots({ visitId: visit.id }),
      getEditAccess({ caseId, scope: "VISIT_IMAGES", visitId: visit.id }),
    ]);

    if (!slotsResult.ok) {
      setError(slotsResult.error.message);
      return;
    }

    setSlots(slotsResult.data);

    if (accessResult.ok) {
      setAccess(accessResult.data);

      // An unsubmitted set is open for editing straight away: the first pass
      // through a visit never needs anyone's approval. Reloading never closes
      // an editing session that is already open — a partly failed save reloads
      // the slots while the clinician still has changes staged.
      setEditing((current) => current || (!accessResult.data.locked && mayUpload));

      setCached(cacheKey, { slots: slotsResult.data, access: accessResult.data });
    }
  }, [caseId, visit.id, mayUpload, cacheKey]);

  useEffect(() => {
    // Fetch-on-mount for the visit's slot grid and this user's editing rights.
    // All state updates happen inside the awaited `load`.
    void load();
  }, [load]);

  // Live updates for this visit: another clinician's upload, or the moment an
  // administrator approves an edit, lands here without a manual reload. Skipped
  // while this tab is mid-save, since it reloads itself when the save lands.
  useRealtime({
    channel: `visit:${visit.id}`,
    tables: [
      { table: "clinical_images", filter: `visit_id=eq.${visit.id}` },
      { table: "case_edit_requests", filter: `case_id=eq.${caseId}` },
    ],
    onChange: () => {
      if (!saving) void load({ fresh: true });
    },
  });

  const stagedCount = Object.keys(staged).length;

  // A refresh or a closed tab would silently discard staged files, which is the
  // one place this design can lose someone's work.
  useEffect(() => {
    if (stagedCount === 0) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);

    return () => window.removeEventListener("beforeunload", warn);
  }, [stagedCount]);

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const stage = useCallback((viewTypeId: string, change: StagedChange | null) => {
    setStaged((current) => {
      const previous = current[viewTypeId];

      if (previous?.kind === "upload") {
        URL.revokeObjectURL(previous.previewUrl);
        previewUrls.current.delete(previous.previewUrl);
      }

      if (change === null) {
        const { [viewTypeId]: _removed, ...rest } = current;
        void _removed;
        return rest;
      }

      if (change.kind === "upload") previewUrls.current.add(change.previewUrl);

      return { ...current, [viewTypeId]: change };
    });
  }, []);

  const discard = useCallback(() => {
    for (const change of Object.values(staged)) {
      if (change.kind === "upload") {
        URL.revokeObjectURL(change.previewUrl);
        previewUrls.current.delete(change.previewUrl);
      }
    }

    setStaged({});
    setSaveError(null);
  }, [staged]);

  /**
   * Applies every staged change, then submits the visit once.
   *
   * Failures are kept staged so a retry re-sends only what did not land, and
   * the submission is skipped entirely unless the whole set applied — a
   * partially applied visit is never announced as submitted.
   */
  const save = useCallback(async () => {
    if (!slots) return;

    setSaving(true);
    setSaveError(null);

    const entries = Object.entries(staged);
    const outcomes = await mapWithConcurrency(entries, MAX_CONCURRENT_IMAGE_SAVES, async ([viewTypeId, change]) => {
      const name =
        slots.find((slot) => slot.viewType.id === viewTypeId)?.viewType.display_name ?? "view";

      try {
        if (change.kind === "upload") {
          setProgress((current) => ({ ...current, [viewTypeId]: 0 }));

          await uploadClinicalImage({
            file: change.file,
            target: { caseId, visitId: visit.id, viewTypeId },
            maxBytes: maxImageBytes,
            onProgress: (value) =>
              setProgress((current) => ({ ...current, [viewTypeId]: value.percent })),
          });
        } else if (change.kind === "remove") {
          const result = await removeSlotImage({ caseId, visitId: visit.id, viewTypeId });
          if (!result.ok) throw new Error(result.error.message);
        } else if (change.kind === "unavailable") {
          const result = await markSlotUnavailable({
            caseId,
            visitId: visit.id,
            viewTypeId,
            ...(change.reason ? { reason: change.reason } : {}),
          });
          if (!result.ok) throw new Error(result.error.message);
        } else {
          const result = await clearSlotUnavailable({ visitId: visit.id, viewTypeId });
          if (!result.ok) throw new Error(result.error.message);
        }

        return { viewTypeId, name, error: null as string | null };
      } catch (cause) {
        return {
          viewTypeId,
          name,
          error: cause instanceof Error ? cause.message : "could not be saved.",
        };
      } finally {
        setProgress((current) => {
          const { [viewTypeId]: _done, ...rest } = current;
          void _done;
          return rest;
        });
      }
    });

    const applied = outcomes
      .filter((outcome) => outcome.error === null)
      .map((outcome) => outcome.viewTypeId);
    const failures = outcomes
      .filter((outcome) => outcome.error !== null)
      .map((outcome) => `${outcome.name}: ${outcome.error}`);

    // Drop what succeeded; anything left is what still needs attention.
    setStaged((current) => {
      const next = { ...current };
      for (const viewTypeId of applied) {
        const change = next[viewTypeId];
        if (change?.kind === "upload") {
          URL.revokeObjectURL(change.previewUrl);
          previewUrls.current.delete(change.previewUrl);
        }
        delete next[viewTypeId];
      }
      return next;
    });

    if (failures.length > 0) {
      setSaveError(failures.join(" "));
      setSaving(false);
      await load({ fresh: true });
      return;
    }

    const submission = await submitVisitImages({ caseId, visitId: visit.id });

    setSaving(false);

    if (!submission.ok) {
      setSaveError(submission.error.message);
      await load({ fresh: true });
      return;
    }

    setSavedAt(new Date().toISOString());
    setEditing(false);
    toast.success(`${visit.display_label} images saved. An administrator has been notified.`);

    await load({ fresh: true });
    router.refresh();
  }, [caseId, load, maxImageBytes, router, slots, staged, visit.display_label, visit.id]);

  const uploadedSlots = useMemo(
    () => (slots ?? []).filter((slot) => slot.currentVersion !== null),
    [slots],
  );

  const resolved = slots ? projectedResolvedCount(slots, staged) : 0;
  const locked = access?.locked ?? visit.images_locked_at !== null;
  // `allowed` covers both an approved grant and an administrator, who is their
  // own approver and never has a grant to show.
  const mayEditNow = access?.allowed ?? false;
  const approved = Boolean(access?.grantId);
  const awaiting = Boolean(access?.pendingRequestId);
  const busy = saving || Object.keys(progress).length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="flex flex-wrap items-center gap-2">
                <Images className="size-4" aria-hidden />
                {visit.display_label}
                {locked ? (
                  <Badge variant="secondary" className="gap-1">
                    <Lock className="size-3" aria-hidden />
                    Submitted
                  </Badge>
                ) : null}
                {approved ? (
                  <Badge variant="outline" className="gap-1 border-emerald-500/60 text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="size-3" aria-hidden />
                    Edit approved
                  </Badge>
                ) : null}
                {awaiting ? (
                  <Badge variant="outline" className="gap-1">
                    <ShieldQuestion className="size-3" aria-hidden />
                    Awaiting approval
                  </Badge>
                ) : null}
              </CardTitle>

              <CardDescription>
                {visit.visit_date ? `Visit date ${formatClinicDate(visit.visit_date)}. ` : ""}
                {slots ? `${resolved} of ${viewTypes.length} standard views resolved. ` : ""}
                This phase is saved on its own — the other phases stay open until their own
                images are taken. Originals are stored unaltered — never edited, cropped or
                filtered. Maximum {formatBytes(maxImageBytes)} per image (JPEG or PNG).
              </CardDescription>

              {visit.images_locked_at && !editing ? (
                <p className="text-muted-foreground text-xs">
                  Submitted {formatTimestamp(visit.images_locked_at)}.
                </p>
              ) : null}

              {savedAt ? (
                <p className="text-muted-foreground flex items-center gap-1 text-xs">
                  <CheckCircle2 className="size-3" aria-hidden />
                  Saved at {formatTimestamp(savedAt)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  {stagedCount > 0 ? (
                    <Button variant="ghost" size="sm" onClick={discard} disabled={busy}>
                      <Undo2 aria-hidden />
                      Discard {stagedCount} change{stagedCount === 1 ? "" : "s"}
                    </Button>
                  ) : null}

                  <Button size="sm" onClick={() => void save()} disabled={busy || stagedCount === 0}>
                    {busy ? <Spinner /> : <Save aria-hidden />}
                    Save images
                  </Button>
                </>
              ) : locked && mayUpload && mayEditNow ? (
                <Button size="sm" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden />
                  Edit images
                </Button>
              ) : locked && mayRequest && !mayEditNow && !awaiting ? (
                <Button size="sm" variant="outline" onClick={() => setRequesting(true)}>
                  <ShieldQuestion aria-hidden />
                  Request approval to edit
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>

        {visit.clinical_observation ? (
          <CardContent>
            <div className="bg-muted/40 rounded-md border p-3">
              <p className="text-muted-foreground mb-1 text-xs font-medium">
                Follow-up observation
              </p>
              <p className="text-sm whitespace-pre-line">{visit.clinical_observation}</p>
            </div>
          </CardContent>
        ) : null}
      </Card>

      {editing && stagedCount > 0 ? (
        <Alert>
          <AlertTitle>
            {stagedCount} change{stagedCount === 1 ? "" : "s"} held on this device
          </AlertTitle>
          <AlertDescription>
            Nothing has been uploaded yet. Choose the views you have, then save the set in one go.
            Saving closes this phase only; the others are unaffected.
          </AlertDescription>
        </Alert>
      ) : null}

      {locked && awaiting && !editing ? (
        <Alert>
          <AlertTitle>Waiting for an administrator</AlertTitle>
          <AlertDescription>
            Your request to edit these images has been sent and is awaiting a decision.
          </AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <Spinner />
          Saving {stagedCount} change{stagedCount === 1 ? "" : "s"} — each image uploads directly to
          secure storage.
        </p>
      ) : null}

      {saveError ? (
        <Alert variant="destructive">
          <AlertTitle>Some changes were not saved</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load images</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            {error}
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw aria-hidden />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {slots === null && !error ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {viewTypes.map((viewType) => (
            <Skeleton key={viewType.id} className="aspect-4/5 w-full" />
          ))}
        </div>
      ) : null}

      {slots !== null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {slots.map((slot) => (
            <ImageSlotCard
              key={slot.viewType.id}
              slot={slot}
              editing={editing}
              staged={staged[slot.viewType.id]}
              progress={progress[slot.viewType.id] ?? null}
              maySelect={mayUpload}
              mayMark={mayMark}
              maxImageBytes={maxImageBytes}
              onStage={(change) => stage(slot.viewType.id, change)}
              onOpenViewer={() => {
                const index = uploadedSlots.findIndex(
                  (candidate) => candidate.viewType.id === slot.viewType.id,
                );
                if (index >= 0) setViewerIndex(index);
              }}
            />
          ))}
        </div>
      ) : null}

      <ImageViewerDialog
        slots={uploadedSlots}
        index={viewerIndex}
        onIndexChange={setViewerIndex}
        visitLabel={visit.display_label}
      />

      <RequestEditDialog
        open={requesting}
        onOpenChange={setRequesting}
        caseId={caseId}
        scope="VISIT_IMAGES"
        visitId={visit.id}
        sectionLabel={`${visit.display_label} images`}
        onRequested={() => load({ fresh: true })}
      />
    </div>
  );
}

/** Runs independent view changes in bounded parallel batches, preserving order. */
async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}
