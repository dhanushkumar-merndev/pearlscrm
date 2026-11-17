"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing } from "lucide-react";
import { toast } from "sonner";

import { DoctorSelect, type DoctorChoice } from "@/components/app/doctor-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatClinicDate, todayIsoDate } from "@/lib/dates";
import { formatClinicDateTime, surgeryReminderTimes } from "@/lib/reminders";
import { markForSurgery } from "@/server/actions/treatments";

/**
 * Mark for Surgery: date + surgeon. Saving schedules two automatic reminders
 * (evening before, morning of) to the surgeon and the branch's staff, as a
 * bell notification and a browser push on every device they enabled.
 */
export function MarkSurgeryDialog({
  open,
  onOpenChange,
  caseId,
  caseNumber,
  currentDate,
  currentSurgeonId,
  doctors,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  caseNumber: string;
  currentDate: string | null;
  currentSurgeonId: string | null;
  doctors: DoctorChoice[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const today = todayIsoDate();
  const [surgeryDate, setSurgeryDate] = useState(currentDate && currentDate >= today ? currentDate : "");
  const [surgeonId, setSurgeonId] = useState<string | null>(currentSurgeonId);
  const [error, setError] = useState<string | null>(null);

  const reminders = useMemo(
    () => (surgeryDate ? surgeryReminderTimes(surgeryDate) : []),
    [surgeryDate],
  );

  const submit = () => {
    if (!surgeonId) return;
    setError(null);
    startTransition(async () => {
      const result = await markForSurgery({ caseId, surgeryDate, surgeonId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(`${caseNumber} marked for surgery on ${formatClinicDate(result.data.surgeryDate)}.`);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{currentDate ? "Reschedule surgery" : "Mark for surgery"}</DialogTitle>
          <DialogDescription>
            Reminders go to the surgeon and the branch&apos;s staff automatically.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <Field>
            <FieldLabel htmlFor="surgery-date">Surgery date</FieldLabel>
            <Input
              id="surgery-date"
              type="date"
              min={today}
              value={surgeryDate}
              onChange={(event) => setSurgeryDate(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="surgery-surgeon">Surgeon</FieldLabel>
            <DoctorSelect
              id="surgery-surgeon"
              doctors={doctors}
              value={surgeonId}
              onValueChange={setSurgeonId}
              placeholder="Choose the operating surgeon"
            />
            <FieldDescription>The surgeon is given access to this treatment.</FieldDescription>
          </Field>

          {reminders.length ? (
            <Alert>
              <BellRing aria-hidden />
              <AlertTitle>Reminders</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-0.5 pl-4">
                  {reminders.map((r) => (
                    <li key={r.kind} className={r.skipped ? "text-muted-foreground line-through" : undefined}>
                      {r.kind === "DAY_BEFORE" ? "Evening before" : "Morning of surgery"}:{" "}
                      {formatClinicDateTime(r.at)}
                      {r.skipped ? " (already passed — skipped)" : ""}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !surgeryDate || !surgeonId || surgeryDate < today}>
            {pending ? <Spinner /> : null}
            {currentDate ? "Reschedule" : "Mark for surgery"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
