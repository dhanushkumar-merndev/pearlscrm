"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DoctorSelect, type DoctorChoice } from "@/components/app/doctor-select";
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
import { addSession } from "@/server/actions/treatments";

/** Records one treatment session. Its Before and After photos are added on the session card. */
export function AddSessionDialog({
  open,
  onOpenChange,
  onAdded,
  caseId,
  sessionNumber,
  doctors,
  currentUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new session's visit id so the caller can select it. */
  onAdded?: (visitId: string) => void;
  caseId: string;
  sessionNumber: number;
  doctors: DoctorChoice[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [visitDate, setVisitDate] = useState(todayIsoDate());
  const [doctorId, setDoctorId] = useState<string | null>(
    doctors.some((d) => d.id === currentUserId) ? currentUserId : null,
  );
  const [observation, setObservation] = useState("");
  const [nextVisitDate, setNextVisitDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nextError =
    nextVisitDate && visitDate && nextVisitDate < visitDate
      ? "The next visit cannot be before this session."
      : null;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await addSession({
        caseId,
        visitDate,
        doctorId,
        observation,
        nextVisitDate,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(`Session ${result.data.session_number ?? sessionNumber} added. Upload its Before and After photos.`);
      onAdded?.(result.data.id);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add session {sessionNumber}</DialogTitle>
          <DialogDescription>
            Before and After photos are required for every session; it can be completed once both
            are uploaded.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <Field>
            <FieldLabel htmlFor="session-date">Session date</FieldLabel>
            <Input
              id="session-date"
              type="date"
              value={visitDate}
              onChange={(event) => setVisitDate(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="session-doctor">Doctor</FieldLabel>
            <DoctorSelect
              id="session-doctor"
              doctors={doctors}
              value={doctorId}
              onValueChange={setDoctorId}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="session-observation">Notes</FieldLabel>
            <Textarea
              id="session-observation"
              rows={3}
              value={observation}
              onChange={(event) => setObservation(event.target.value)}
              placeholder="Settings used, response, anything to watch next time"
            />
          </Field>

          <Field data-invalid={Boolean(nextError)}>
            <FieldLabel htmlFor="session-next">Next visit</FieldLabel>
            <Input
              id="session-next"
              type="date"
              min={visitDate || undefined}
              value={nextVisitDate}
              aria-invalid={Boolean(nextError)}
              onChange={(event) => setNextVisitDate(event.target.value)}
            />
            <FieldDescription>Optional. Shows on the patient and the dashboard.</FieldDescription>
            <FieldError>{nextError}</FieldError>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !visitDate || Boolean(nextError)}>
            {pending ? <Spinner /> : null}
            Add session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
