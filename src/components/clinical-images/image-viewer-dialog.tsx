"use client";

import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { SecureImage } from "@/components/clinical-images/secure-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatTimestamp } from "@/lib/dates";
import { formatBytes } from "@/lib/images";
import type { ImageSlot } from "@/lib/types";

/**
 * Simple secure clinical preview: fit to screen, step through the views of the
 * current visit, and read the image metadata.
 *
 * Deliberately has no editing controls — no crop, filters, brightness, retouch
 * or annotation. Clinical originals are viewed, never altered.
 */
export function ImageViewerDialog({
  slots,
  index,
  onIndexChange,
  visitLabel,
}: {
  slots: ImageSlot[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
  visitLabel: string;
}) {
  const open = index !== null && index >= 0 && index < slots.length;
  const slot = open ? slots[index] : null;

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (event.key === "ArrowRight" && index < slots.length - 1) onIndexChange(index + 1);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, slots.length, onIndexChange]);

  if (!slot?.image || !slot.currentVersion) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onIndexChange(null)}>
      <DialogContent className="max-h-[92svh] gap-4 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {visitLabel} — {slot.viewType.display_name}
          </DialogTitle>
          <DialogDescription>
            {formatBytes(slot.currentVersion.file_size)} · {slot.currentVersion.mime_type} ·
            uploaded {formatTimestamp(slot.currentVersion.uploaded_at)}
            {slot.uploadedByName ? ` by ${slot.uploadedByName}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted/40 flex max-h-[60svh] items-center justify-center overflow-hidden rounded-md border">
          <SecureImage
            key={slot.image.id}
            imageId={slot.image.id}
            versionId={slot.currentVersion.id}
            alt={`${slot.viewType.display_name} clinical view`}
            className="max-h-[60svh] object-contain"
            eager
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={index === null || index <= 0}
            onClick={() => index !== null && onIndexChange(index - 1)}
          >
            <ChevronLeft aria-hidden />
            Previous
          </Button>

          <span className="text-muted-foreground text-xs tabular-nums">
            {(index ?? 0) + 1} of {slots.length}
          </span>

          <Button
            variant="outline"
            size="sm"
            disabled={index === null || index >= slots.length - 1}
            onClick={() => index !== null && onIndexChange(index + 1)}
          >
            Next
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
