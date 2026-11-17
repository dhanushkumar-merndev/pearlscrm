"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { TreatmentPlanFields, emptyPlan, type PlanState } from "@/components/patients/treatment-plan-fields";
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
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { todayIsoDate } from "@/lib/dates";
import { DOCUMENT_MIME_TYPES } from "@/lib/documents";
import { uploadPatientDocument } from "@/lib/document-upload-client";
import { addPatientNote, recordConsultation } from "@/server/actions/patients";
import { createTreatment } from "@/server/actions/treatments";
import type { Branch, CaseListRow, RoleCode } from "@/lib/types";
import type { NamedConsultation } from "@/server/queries/patients";

type Base = { open: boolean; onOpenChange: (open: boolean) => void; patientId: string };

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="text-destructive text-sm" role="alert">
      {error}
    </p>
  ) : null;
}

/** Add Treatment: a new procedure for an existing patient (e.g. Rhinoplasty after LHR). */
export function AddTreatmentDialog({
  open,
  onOpenChange,
  patientId,
  branchId,
  consultations,
  role,
}: Base & { branchId: string; consultations: NamedConsultation[]; role: RoleCode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [plan, setPlan] = useState<PlanState>(emptyPlan);
  const [consultationId, setConsultationId] = useState<string>(consultations[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (!plan.procedureId) {
      setError("Choose the procedure.");
      return;
    }
    startTransition(async () => {
      const result = await createTreatment({
        patientId,
        branchId,
        procedureId: plan.procedureId,
        procedureTypeId: plan.procedureTypeId || null,
        mode: plan.mode,
        plannedSessions: plan.mode === "SESSIONS" ? plan.plannedSessions : null,
        startDate: plan.mode === "SESSIONS" ? plan.startDate : null,
        surgeryDate: null,
        consultationId: consultationId || null,
        tagIds: [],
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(`Treatment ${result.data.caseNumber} added`);
      onOpenChange(false);
      router.push(`/cases/${result.data.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add treatment</DialogTitle>
          <DialogDescription>
            Each treatment gets its own case number and keeps its own photos and notes.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <ErrorLine error={error} />
          <TreatmentPlanFields value={plan} onChange={setPlan} role={role} idPrefix="add-treatment" />
          {consultations.length > 0 ? (
            <Field>
              <FieldLabel htmlFor="add-treatment-visit">Planned at visit</FieldLabel>
              <Select value={consultationId} onValueChange={setConsultationId}>
                <SelectTrigger id="add-treatment-visit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {consultations.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.visit_date.split("-").reverse().join("/")}
                      {c.is_first_visit ? " · First visit" : ""}
                      {c.doctor_name ? ` · ${c.doctor_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Spinner /> : null}
            Add treatment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Doctor's comment, optionally against one treatment, with an optional next visit. */
export function AddNoteDialog({
  open,
  onOpenChange,
  patientId,
  treatments,
}: Base & { treatments: CaseListRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [caseId, setCaseId] = useState("__none__");
  const [nextVisitDate, setNextVisitDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await addPatientNote({
        patientId,
        caseId: caseId === "__none__" ? null : caseId,
        body,
        nextVisitDate,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success("Note added");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add note</DialogTitle>
          <DialogDescription>Notes are permanent; add another note to correct one.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <ErrorLine error={error} />
          <Field>
            <FieldLabel htmlFor="note-body">Comment</FieldLabel>
            <Textarea id="note-body" rows={5} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {treatments.length > 0 ? (
            <Field>
              <FieldLabel htmlFor="note-case">About</FieldLabel>
              <Select value={caseId} onValueChange={setCaseId}>
                <SelectTrigger id="note-case" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">The patient in general</SelectItem>
                  {treatments.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.case_number} · {t.procedure_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="note-next">Next visit</FieldLabel>
            <Input id="note-next" type="date" min={todayIsoDate()} value={nextVisitDate} onChange={(e) => setNextVisitDate(e.target.value)} />
            <FieldDescription>Optional.</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !body.trim()}>
            {pending ? <Spinner /> : null}
            Add note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A later consultation (the first one is recorded at registration). */
export function RecordVisitDialog({
  open,
  onOpenChange,
  patientId,
  branches,
  defaultBranchId,
}: Base & { branches: Branch[]; defaultBranchId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [visitDate, setVisitDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState("");
  const [nextVisitDate, setNextVisitDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await recordConsultation({ patientId, branchId, visitDate, notes, nextVisitDate });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (file) {
        try {
          await uploadPatientDocument({ file, patientId, consultationId: result.data.id });
        } catch (uploadError) {
          toast.error(`Visit saved, but the prescription was not uploaded: ${(uploadError as Error).message}`);
        }
      }
      toast.success("Visit recorded");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record visit</DialogTitle>
          <DialogDescription>A consultation at any branch, with an optional prescription.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <ErrorLine error={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="visit-branch">Branch</FieldLabel>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger id="visit-branch" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="visit-date">Date</FieldLabel>
              <Input id="visit-date" type="date" max={todayIsoDate()} value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="visit-notes">Notes</FieldLabel>
            <Textarea id="visit-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="visit-next">Next visit</FieldLabel>
            <Input id="visit-next" type="date" min={visitDate} value={nextVisitDate} onChange={(e) => setNextVisitDate(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="visit-rx">Prescription</FieldLabel>
            <Input id="visit-rx" type="file" accept={DOCUMENT_MIME_TYPES.join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !visitDate || !branchId}>
            {pending ? <Spinner /> : null}
            Record visit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Upload a prescription against a visit. */
export function UploadPrescriptionDialog({
  open,
  onOpenChange,
  patientId,
  consultations,
}: Base & { consultations: NamedConsultation[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [consultationId, setConsultationId] = useState(consultations[0]?.id ?? "__none__");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      await uploadPatientDocument({
        file,
        patientId,
        consultationId: consultationId === "__none__" ? null : consultationId,
        onProgress: (p) => setProgress(p.percent),
      });
      toast.success("Prescription uploaded");
      onOpenChange(false);
      router.refresh();
    } catch (uploadError) {
      setError((uploadError as Error).message);
      setProgress(null);
    }
  };

  const busy = progress !== null;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload prescription</DialogTitle>
          <DialogDescription>PDF, JPEG or PNG up to 10 MB, stored privately and never altered.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <ErrorLine error={error} />
          <Field>
            <FieldLabel htmlFor="rx-file">File</FieldLabel>
            <Input id="rx-file" type="file" accept={DOCUMENT_MIME_TYPES.join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={busy} />
          </Field>
          <Field>
            <FieldLabel htmlFor="rx-visit">Visit</FieldLabel>
            <Select value={consultationId} onValueChange={setConsultationId} disabled={busy}>
              <SelectTrigger id="rx-visit" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not linked to a visit</SelectItem>
                {consultations.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.visit_date.split("-").reverse().join("/")}
                    {c.is_first_visit ? " · First visit" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {busy ? <Progress value={progress} aria-label="Upload progress" /> : null}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!file || busy}>
            {busy ? <Spinner /> : null}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
