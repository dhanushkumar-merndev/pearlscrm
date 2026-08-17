"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { todayIsoDate } from "@/lib/dates";
import { createFollowup, suggestVisitLabel, updateVisit } from "@/server/actions/visits";
import type { CaseVisit } from "@/lib/types";

/**
 * Add or edit a follow-up visit.
 *
 * Entering a visit date asks the server to suggest an interval label. The
 * suggestion is only a starting point — the clinician can replace it, and a
 * visit at 5 months stays a 5-month visit rather than being forced to a preset.
 */
export function FollowupDialog({
  open,
  onOpenChange,
  caseId,
  surgeryDate,
  visit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  surgeryDate: string;
  visit: CaseVisit | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [visitDate, setVisitDate] = useState("");
  const [label, setLabel] = useState("");
  const [observation, setObservation] = useState("");
  const [labelEdited, setLabelEdited] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setVisitDate(visit?.visit_date ?? "");
    setLabel(visit?.display_label ?? "");
    setObservation(visit?.clinical_observation ?? "");
    setLabelEdited(Boolean(visit));
    setError(null);
    setDateError(null);
  }, [open, visit]);

  useEffect(() => {
    if (!open || !visitDate) return;

    if (visitDate < surgeryDate) {
      setDateError("The visit date is before the surgery date.");
      return;
    }

    setDateError(null);

    // Only suggest while the user has not taken over the label themselves.
    if (labelEdited) return;

    let cancelled = false;
    setSuggesting(true);

    void suggestVisitLabel({ caseId, visitDate }).then((result) => {
      if (cancelled) return;
      setSuggesting(false);
      if (result.ok) setLabel(result.data.label);
    });

    return () => {
      cancelled = true;
    };
  }, [open, visitDate, surgeryDate, labelEdited, caseId]);

  const submit = () => {
    setError(null);

    startTransition(async () => {
      const result = visit
        ? await updateVisit({
            visitId: visit.id,
            visitDate,
            displayLabel: label,
            clinicalObservation: observation,
          })
        : await createFollowup({
            caseId,
            visitDate,
            displayLabel: label,
            clinicalObservation: observation,
          });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      toast.success(visit ? "Follow-up updated" : "Follow-up added");
      onOpenChange(false);
      router.refresh();
    });
  };

  const valid = visitDate !== "" && label.trim() !== "" && !dateError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{visit ? "Edit follow-up" : "Add follow-up"}</DialogTitle>
          <DialogDescription>
            Record the actual visit date. The suggested label can be changed to whatever describes
            the visit accurately.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <Field data-invalid={Boolean(dateError)}>
            <FieldLabel htmlFor="followup-date">Visit date</FieldLabel>
            <Input
              id="followup-date"
              type="date"
              min={surgeryDate}
              max={todayIsoDate()}
              value={visitDate}
              aria-invalid={Boolean(dateError)}
              onChange={(event) => setVisitDate(event.target.value)}
            />
            <FieldError>{dateError}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="followup-label">
              Label
              {suggesting ? (
                <span className="text-muted-foreground ml-2 inline-flex items-center gap-1 text-xs font-normal">
                  <Sparkles className="size-3" aria-hidden />
                  suggesting…
                </span>
              ) : null}
            </FieldLabel>
            <Input
              id="followup-label"
              value={label}
              maxLength={100}
              onChange={(event) => {
                setLabel(event.target.value);
                setLabelEdited(true);
              }}
              placeholder="e.g. 3 Months"
            />
            <FieldDescription>
              Suggested from the interval since surgery. Correct it if the interval is unusual.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="followup-observation">Follow-up observation</FieldLabel>
            <Textarea
              id="followup-observation"
              rows={4}
              value={observation}
              onChange={(event) => setObservation(event.target.value)}
              placeholder="Clinical observation at this visit"
            />
            <FieldDescription>
              Stored against this visit, not duplicated into fixed 1M/3M/6M/12M fields.
            </FieldDescription>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !valid}>
            {pending ? <Spinner /> : null}
            {visit ? "Save changes" : "Add follow-up"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
