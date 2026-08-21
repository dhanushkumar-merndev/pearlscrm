"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { ImageViewType } from "@/lib/types";

/**
 * Records that a standard view genuinely does not exist for this visit.
 *
 * This is the alternative to uploading the wrong photograph to satisfy a
 * checklist — it makes the completion figure mean something.
 *
 * The dialog only collects the reason: like every other change to an image set,
 * the mark is staged locally and written when the visit is saved.
 */
export function MarkUnavailableDialog({
  open,
  onOpenChange,
  viewType,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewType: ImageViewType;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (next) setReason("");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {viewType.display_name} as not available</DialogTitle>
          <DialogDescription>
            Use this when the view genuinely was not captured. It is recorded against your account
            and appears in the audit history once the visit is saved.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="unavailable-reason">Reason</FieldLabel>
          <Textarea
            id="unavailable-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. View not captured at this visit"
          />
          <FieldDescription>Optional, but helpful for anyone reviewing the case.</FieldDescription>
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onConfirm(reason.trim());
              onOpenChange(false);
            }}
          >
            Mark not available
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
