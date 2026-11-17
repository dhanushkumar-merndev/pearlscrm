"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DoctorSelect, type DoctorChoice } from "@/components/app/doctor-select";
import { MasterDataCombobox } from "@/components/app/master-data-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { currentAge } from "@/lib/file-id";
import { can } from "@/lib/permissions";
import { updatePatient } from "@/server/actions/patients";
import type { PatientListRow, PatientSex, RoleCode } from "@/lib/types";

/** Edits identity and referral. A stale version is refused, never overwritten. */
export function EditPatientDialog({
  open,
  onOpenChange,
  patient,
  doctors,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: PatientListRow;
  doctors: DoctorChoice[];
  role: RoleCode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState(patient.full_name);
  const [phone, setPhone] = useState(patient.phone ?? "");
  const [sex, setSex] = useState<PatientSex | null>(patient.sex);
  const [age, setAge] = useState(String(currentAge(patient.age_years, patient.age_recorded_on) ?? ""));
  const [referredById, setReferredById] = useState<string | null>(patient.referred_by_id);
  const [referredFor, setReferredFor] = useState<string | null>(patient.referred_for_procedure_id);
  const [source, setSource] = useState(patient.referral_source ?? "");
  const [note, setNote] = useState(patient.referral_note ?? "");

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await updatePatient({
        patientId: patient.id,
        expectedVersion: patient.version,
        fullName,
        phone,
        sex,
        ageYears: age,
        referredById,
        referralSource: source,
        referredForProcedureId: referredFor,
        referralNote: note,
      });
      if (!result.ok) {
        setError(
          result.error.code === "CONFLICT"
            ? "Someone else updated this patient while you were editing. Close and reopen to see their changes."
            : result.error.message,
        );
        return;
      }
      toast.success(`${patient.file_id} updated`);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {patient.file_id}</DialogTitle>
          <DialogDescription>The File ID and branch never change.</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <Field>
            <FieldLabel htmlFor="edit-name">Full name</FieldLabel>
            <Input id="edit-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field className="sm:col-span-1">
              <FieldLabel htmlFor="edit-age">Age</FieldLabel>
              <Input id="edit-age" type="number" min={0} max={120} value={age} onChange={(e) => setAge(e.target.value)} />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="edit-sex">Sex</FieldLabel>
              <Select value={sex ?? ""} onValueChange={(v) => setSex((v || null) as PatientSex | null)}>
                <SelectTrigger id="edit-sex" className="w-full">
                  <SelectValue placeholder="Not recorded" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FEMALE">Female</SelectItem>
                  <SelectItem value="MALE">Male</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="edit-phone">Phone</FieldLabel>
            <Input id="edit-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-referred-by">Referred by</FieldLabel>
            <DoctorSelect
              id="edit-referred-by"
              doctors={doctors}
              value={referredById}
              onValueChange={setReferredById}
              allowNone
              noneLabel="Not referred by a doctor"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-referred-for">Referred for</FieldLabel>
            <MasterDataCombobox
              id="edit-referred-for"
              table="procedures"
              label="Referred for"
              value={referredFor}
              onValueChange={(id) => setReferredFor(id)}
              canCreate={can(role, "master_data:create")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-source">Other source</FieldLabel>
            <Input id="edit-source" value={source} onChange={(e) => setSource(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-note">Referral note</FieldLabel>
            <Textarea id="edit-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !fullName.trim()}>
            {pending ? <Spinner /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
