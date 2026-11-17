"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";

import { DoctorSelect, type DoctorChoice } from "@/components/app/doctor-select";
import { MasterDataCombobox } from "@/components/app/master-data-combobox";
import { TreatmentPlanFields, emptyPlan, planIsFilled, type PlanState } from "@/components/patients/treatment-plan-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { todayIsoDate } from "@/lib/dates";
import { DOCUMENT_MIME_TYPES } from "@/lib/documents";
import { uploadPatientDocument } from "@/lib/document-upload-client";
import { can } from "@/lib/permissions";
import { createPatientSchema } from "@/lib/validation/schemas";
import { createPatient } from "@/server/actions/patients";
import { createTreatment } from "@/server/actions/treatments";
import type { Branch, RoleCode } from "@/lib/types";

type FormValues = z.input<typeof createPatientSchema>;
type ParsedValues = z.output<typeof createPatientSchema>;

/**
 * First visit: the patient, who referred them and for what, the consultation,
 * an optional prescription and an optional first treatment plan. The patient is
 * created first (that allocates the File ID); the prescription and plan attach
 * to it afterwards, so a failed upload never loses the registration.
 */
export function RegisterPatientForm({
  role,
  branches,
  doctors,
  defaultBranchId,
}: {
  role: RoleCode;
  branches: Branch[];
  doctors: DoctorChoice[];
  defaultBranchId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [prescription, setPrescription] = useState<File | null>(null);
  const [plan, setPlan] = useState<PlanState>(emptyPlan);
  const [planError, setPlanError] = useState<string | null>(null);
  const canCreateMasterData = can(role, "master_data:create");

  const form = useForm<FormValues, unknown, ParsedValues>({
    resolver: zodResolver(createPatientSchema),
    defaultValues: {
      branchId: defaultBranchId ?? branches[0]?.id ?? "",
      fullName: "",
      phone: "",
      sex: null,
      ageYears: "",
      referredById: null,
      referralSource: "",
      referredForProcedureId: null,
      referralNote: "",
      firstVisitDate: todayIsoDate(),
      consultationNotes: "",
      nextVisitDate: "",
    },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    setPlanError(null);
    if (planIsFilled(plan) && !plan.procedureId) {
      setPlanError("Choose the procedure for the treatment plan, or clear the plan.");
      return;
    }

    startTransition(async () => {
      const created = await createPatient(values);
      if (!created.ok) {
        setFormError(created.error.message);
        return;
      }
      const { id, fileId, consultationId } = created.data;
      const problems: string[] = [];

      if (prescription) {
        try {
          await uploadPatientDocument({ file: prescription, patientId: id, consultationId });
        } catch (error) {
          problems.push(`Prescription not uploaded: ${(error as Error).message}`);
        }
      }

      if (planIsFilled(plan)) {
        const treatment = await createTreatment({
          patientId: id,
          branchId: values.branchId,
          procedureId: plan.procedureId,
          procedureTypeId: plan.procedureTypeId || null,
          mode: plan.mode,
          plannedSessions: plan.mode === "SESSIONS" ? plan.plannedSessions : null,
          startDate: plan.mode === "SESSIONS" ? plan.startDate : null,
          surgeryDate: null,
          consultationId,
          tagIds: [],
        });
        if (!treatment.ok) problems.push(`Treatment plan not saved: ${treatment.error.message}`);
      }

      toast.success(`Registered ${fileId}`);
      for (const problem of problems) toast.error(problem, { duration: 10000 });
      router.push(`/patients/${id}`);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not register the patient</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Patient</CardTitle>
            <CardDescription>
              The File ID is allocated automatically from the branch, e.g. KL0001.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.branchId)}>
                <FieldLabel htmlFor="branchId">Branch</FieldLabel>
                <Controller
                  control={form.control}
                  name="branchId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="branchId" className="w-full">
                        <SelectValue placeholder="Choose the branch" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.code} · {branch.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError errors={[errors.branchId]} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={Boolean(errors.fullName)}>
                  <FieldLabel htmlFor="fullName">Full name</FieldLabel>
                  <Input id="fullName" autoComplete="off" aria-invalid={Boolean(errors.fullName)} {...form.register("fullName")} />
                  <FieldError errors={[errors.fullName]} />
                </Field>
                <Field data-invalid={Boolean(errors.phone)}>
                  <FieldLabel htmlFor="phone">Phone</FieldLabel>
                  <Input id="phone" type="tel" autoComplete="off" aria-invalid={Boolean(errors.phone)} {...form.register("phone")} />
                  <FieldError errors={[errors.phone]} />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={Boolean(errors.ageYears)}>
                  <FieldLabel htmlFor="ageYears">Age</FieldLabel>
                  <Input id="ageYears" type="number" inputMode="numeric" min={0} max={120} aria-invalid={Boolean(errors.ageYears)} {...form.register("ageYears")} />
                  <FieldError errors={[errors.ageYears]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sex">Sex</FieldLabel>
                  <Controller
                    control={form.control}
                    name="sex"
                    render={({ field }) => (
                      <Select value={field.value ?? ""} onValueChange={(value) => field.onChange(value || null)}>
                        <SelectTrigger id="sex" className="w-full">
                          <SelectValue placeholder="Not recorded" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FEMALE">Female</SelectItem>
                          <SelectItem value="MALE">Male</SelectItem>
                          <SelectItem value="OTHER">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Referral</CardTitle>
            <CardDescription>
              Shown as a reminder to every doctor who opens this patient, at any branch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="referredById">Referred by</FieldLabel>
                  <Controller
                    control={form.control}
                    name="referredById"
                    render={({ field }) => (
                      <DoctorSelect
                        id="referredById"
                        doctors={doctors}
                        value={field.value ?? null}
                        onValueChange={field.onChange}
                        allowNone
                        noneLabel="Not referred by a doctor"
                      />
                    )}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="referredForProcedureId">Referred for</FieldLabel>
                  <Controller
                    control={form.control}
                    name="referredForProcedureId"
                    render={({ field }) => (
                      <MasterDataCombobox
                        id="referredForProcedureId"
                        table="procedures"
                        label="Referred for"
                        value={field.value ?? null}
                        onValueChange={(id) => field.onChange(id)}
                        placeholder="Select or type a treatment"
                        canCreate={canCreateMasterData}
                      />
                    )}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="referralSource">Other source</FieldLabel>
                <Input id="referralSource" placeholder="e.g. Instagram, a friend, another clinic" {...form.register("referralSource")} />
              </Field>
              <Field>
                <FieldLabel htmlFor="referralNote">Referral note</FieldLabel>
                <Textarea id="referralNote" rows={2} {...form.register("referralNote")} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Treatment plan</CardTitle>
            <CardDescription>Optional now; more treatments can be added later.</CardDescription>
          </CardHeader>
          <CardContent>
            <TreatmentPlanFields value={plan} onChange={setPlan} role={role} error={planError} />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>First visit</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.firstVisitDate)}>
                <FieldLabel htmlFor="firstVisitDate">Consultation date</FieldLabel>
                <Input id="firstVisitDate" type="date" max={todayIsoDate()} {...form.register("firstVisitDate")} />
                <FieldError errors={[errors.firstVisitDate]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="consultationNotes">Consultation notes</FieldLabel>
                <Textarea id="consultationNotes" rows={4} {...form.register("consultationNotes")} />
              </Field>
              <Field data-invalid={Boolean(errors.nextVisitDate)}>
                <FieldLabel htmlFor="nextVisitDate">Next visit</FieldLabel>
                <Input id="nextVisitDate" type="date" {...form.register("nextVisitDate")} />
                <FieldError errors={[errors.nextVisitDate]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="prescription">Prescription</FieldLabel>
                <Input
                  id="prescription"
                  type="file"
                  accept={DOCUMENT_MIME_TYPES.join(",")}
                  onChange={(event) => setPrescription(event.target.files?.[0] ?? null)}
                />
                <FieldDescription>PDF, JPEG or PNG, up to 10 MB. Stored privately.</FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Spinner /> : null}
          Register patient
        </Button>
      </div>
    </form>
  );
}
