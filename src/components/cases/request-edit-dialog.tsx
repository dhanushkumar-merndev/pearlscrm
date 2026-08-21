"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldQuestion } from "lucide-react";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { requestCaseEdit } from "@/server/actions/edit-requests";
import type { EditScope } from "@/lib/types";

const MIN_REASON_LENGTH = 10;

/**
 * Asks an administrator to reopen a section that has already been submitted.
 *
 * The reason is mandatory and travels with the request: an approval is a
 * clinical decision, and the person granting it needs to know what is being
 * changed and why before they do.
 */
export function RequestEditDialog({
  open,
  onOpenChange,
  caseId,
  scope,
  visitId,
  sectionLabel,
  onRequested,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  scope: EditScope;
  visitId?: string;
  /** How the section is named to the user, e.g. "Before images". */
  sectionLabel: string;
  onRequested?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmed = reason.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_REASON_LENGTH;

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (next) {
      setReason("");
      setError(null);
    }
  };

  const submit = () => {
    setError(null);

    startTransition(async () => {
      const result = await requestCaseEdit({
        caseId,
        scope,
        ...(visitId ? { visitId } : {}),
        reason: trimmed,
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      toast.success("Request sent. An administrator has been notified.");
      onOpenChange(false);
      await onRequested?.();
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldQuestion className="size-4" aria-hidden />
            Request approval to edit {sectionLabel}
          </DialogTitle>
          <DialogDescription>
            This section has already been submitted. An administrator reviews your reason and, if
            they approve, you get a single editing pass — saving your changes closes it again.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <Field data-invalid={tooShort}>
          <FieldLabel htmlFor="edit-request-reason">Reason for the change</FieldLabel>
          <Textarea
            id="edit-request-reason"
            rows={4}
            maxLength={1000}
            value={reason}
            aria-invalid={tooShort}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. The left profile was uploaded to the wrong view and needs to be corrected."
          />
          <FieldDescription>
            Recorded against the case and shown to the administrator who decides.
          </FieldDescription>
          <FieldError>
            {tooShort ? `Use at least ${MIN_REASON_LENGTH} characters.` : null}
          </FieldError>
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || trimmed.length < MIN_REASON_LENGTH}>
            {pending ? <Spinner /> : null}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
