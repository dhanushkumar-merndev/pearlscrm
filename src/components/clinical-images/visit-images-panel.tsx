"use client";

import { useCallback, useEffect, useState } from "react";
import { Images, RefreshCw } from "lucide-react";

import { ImageSlotCard } from "@/components/clinical-images/image-slot-card";
import { ImageViewerDialog } from "@/components/clinical-images/image-viewer-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClinicDate } from "@/lib/dates";
import { formatBytes } from "@/lib/images";
import { getVisitSlots } from "@/server/actions/image-slots";
import type { CaseVisit, ImageSlot, ImageViewType, RoleCode } from "@/lib/types";

/**
 * The standard clinical view grid for one visit.
 *
 * Every expected view renders a card whether or not an image exists, so a
 * missing view is visible rather than merely absent. Layout is 3 columns on
 * desktop, 2 on tablet, 1 on phone.
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
  const [slots, setSlots] = useState<ImageSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);

    const result = await getVisitSlots({ visitId: visit.id });

    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    setSlots(result.data);
  }, [visit.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadedSlots = (slots ?? []).filter((slot) => slot.currentVersion !== null);

  const resolved = (slots ?? []).filter(
    (slot) =>
      slot.image?.availability_status === "UPLOADED" ||
      slot.image?.availability_status === "NOT_AVAILABLE",
  ).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Images className="size-4" aria-hidden />
            {visit.display_label}
          </CardTitle>
          <CardDescription>
            {visit.visit_date ? `Visit date ${formatClinicDate(visit.visit_date)}. ` : ""}
            {slots ? `${resolved} of ${viewTypes.length} standard views resolved. ` : ""}
            Originals are stored unaltered — never edited, cropped or filtered. Maximum{" "}
            {formatBytes(maxImageBytes)} per image (JPEG or PNG).
          </CardDescription>
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
              caseId={caseId}
              visitId={visit.id}
              slot={slot}
              role={role}
              maxImageBytes={maxImageBytes}
              readOnly={readOnly}
              onChanged={load}
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
    </div>
  );
}
