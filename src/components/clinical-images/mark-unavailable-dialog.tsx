"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { markSlotUnavailable } from "@/server/actions/images";
import type { ImageViewType } from "@/lib/types";

/**
 * Records that a standard view genuinely does not exist for this visit.
 *
 * This is the alternative to uploading the wrong photograph to satisfy a
 * checklist — it makes the completion figure mean something.
 */
export function MarkUnavailableDialog({
  open,
  onOpenChange,
  caseId,
  visitId,
  viewType,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  visitId: string;
  viewType: ImageViewType;
  onDone: () => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await markSlotUnavailable({
        caseId,
        visitId,
        viewTypeId: viewType.id,
        reason: reason.trim() || undefined,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success(`${viewType.display_name} marked not available`);
      setReason("");
      onOpenChange(false);
      await onDone();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {viewType.display_name} as not available</DialogTitle>
          <DialogDescription>
            Use this when the view genuinely was not captured. It is recorded against your account
            and appears in the audit history.
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Spinner /> : null}
            Mark not available
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
