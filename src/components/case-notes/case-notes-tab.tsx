"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  GripVertical,
  Plus,
  Save,
  ShieldQuestion,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";

import { MasterDataCombobox } from "@/components/app/master-data-combobox";
import { RequestEditDialog } from "@/components/cases/request-edit-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/permissions";
import { updateCaseNotesSchema } from "@/lib/validation/schemas";
import { updateCaseNotes } from "@/server/actions/notes";
import type { CaseDetail } from "@/server/queries/cases";
import type { EditAccess, RoleCode } from "@/lib/types";

/**
 * The schema trims and null-coerces, so its parsed output differs from the form
 * input. `useForm` therefore needs both types — the third generic is the
 * resolver's output.
 */
type FormValues = z.input<typeof updateCaseNotesSchema>;
type ParsedValues = z.output<typeof updateCaseNotesSchema>;
type NotesForm = UseFormReturn<FormValues, unknown, ParsedValues>;

/**
 * Structured clinical case notes.
 *
 * Saved explicitly — there is no keystroke autosave into production clinical
 * records. Unsaved changes are signalled, navigation away is warned about, and a
 * concurrent edit by another clinician surfaces as a conflict rather than
 * silently overwriting their work.
 */
export function CaseNotesTab({
  detail,
  role,
  editAccess,
}: {
  detail: CaseDetail;
  role: RoleCode;
  editAccess: EditAccess;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [draggingChangeId, setDraggingChangeId] = useState<string | null>(null);

  const notes = detail.notes;
  const editable =
    can(role, "notes:update") && !detail.summary.archived_at && editAccess.allowed;
  const mayRequest = can(role, "edit_request:create") && editAccess.locked && !editAccess.allowed;

  const form = useForm<FormValues, unknown, ParsedValues>({
    resolver: zodResolver(updateCaseNotesSchema),
    defaultValues: {
      caseId: detail.summary.id,
      expectedVersion: notes?.version ?? 1,
      patientConcern: notes?.patient_concern ?? "",
      preopAssessment: notes?.preop_assessment ?? "",
      treatmentRecommendation: notes?.treatment_recommendation ?? "",
      preopAestheticGoal: notes?.preop_aesthetic_goal ?? "",
      dorsum: notes?.dorsum ?? "",
      tip: notes?.tip ?? "",
      projection: notes?.projection ?? "",
      rotation: notes?.rotation ?? "",
      alar: notes?.alar ?? "",
      septum: notes?.septum ?? "",
      otherAnatomicalChange: notes?.other_anatomical_change ?? "",
      surgeonAssessment: notes?.surgeon_assessment ?? "",
      outcome: notes?.outcome ?? "",
      patientSatisfaction: notes?.patient_satisfaction ?? "",
      complicationsPresent: notes?.complications_present ?? null,
      complicationTypeId: notes?.complication_type_id ?? null,
      complicationDetails: notes?.complication_details ?? "",
      revisionRequired: notes?.revision_required ?? null,
      changesPerformed: detail.changesPerformed.map((change) => ({
        id: change.id,
        description: change.description,
      })),
    },
  });

  const changes = useFieldArray({ control: form.control, name: "changesPerformed" });
  const dirty = form.formState.isDirty;

  // Guards against losing work to a full page navigation or tab close.
  useEffect(() => {
    if (!dirty) return;

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    setConflict(false);

    startTransition(async () => {
      const result = await updateCaseNotes(values);

      if (!result.ok) {
        if (result.error.code === "CONFLICT") {
          setConflict(true);
          return;
        }
        setError(result.error.message);
        return;
      }

      // Advance the expected version so a second save in the same session works.
      form.setValue("expectedVersion", result.data.version);
      form.reset(form.getValues(), { keepValues: true });
      setSavedAt(result.data.savedAt);

      toast.success("Case notes saved");
      router.refresh();
    });
  });

  // eslint-disable-next-line react-hooks/incompatible-library -- RHF watch() cannot be memoized; skipping memoization of this form is intentional and safe.
  const complicationsPresent = form.watch("complicationsPresent");

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Case notes</h2>
          <p className="text-muted-foreground text-sm">
            {editable
              ? editAccess.locked && role !== "ADMIN"
                ? "Administrator-approved editing pass. Saving closes this section again."
                : "Changes are saved only when you press Save. The first save locks this section."
              : editAccess.pendingRequestId
                ? "Your request to edit these notes is awaiting administrator approval."
                : editAccess.locked
                  ? "These notes are locked after submission. Request approval to edit them."
                  : "You have read-only access to these notes."}
          </p>
        </div>

        {editable ? (
          <div className="flex items-center gap-3">
            {dirty ? (
              <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                Unsaved changes
              </Badge>
            ) : savedAt ? (
              <span className="text-muted-foreground text-sm">
                Saved at{" "}
                {new Date(savedAt).toLocaleTimeString("en-GB", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            ) : null}

            <Button type="submit" disabled={pending || !dirty}>
              {pending ? <Spinner /> : <Save aria-hidden />}
              Save notes
            </Button>
          </div>
        ) : mayRequest ? (
          <Button type="button" variant="outline" onClick={() => setRequesting(true)}>
            <ShieldQuestion aria-hidden />
            Request edit approval
          </Button>
        ) : null}
      </div>

      {conflict ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>These notes were changed by someone else</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            Your changes were not saved, so nothing has been overwritten. Reload the case to see the
            latest notes, then reapply your edits.
            <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
              Reload latest notes
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save the notes</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Patient concern &amp; pre-operative assessment</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <NoteField
              form={form}
              name="patientConcern"
              label="Patient concern"
              rows={4}
              disabled={!editable}
            />
            <NoteField
              form={form}
              name="preopAssessment"
              label="Pre-operative assessment"
              rows={4}
              disabled={!editable}
            />
            <NoteField
              form={form}
              name="treatmentRecommendation"
              label="Treatment recommendation before surgery"
              rows={3}
              disabled={!editable}
            />
            <NoteField
              form={form}
              name="preopAestheticGoal"
              label="Pre-operative aesthetic goal"
              rows={3}
              disabled={!editable}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Changes performed</CardTitle>
          <CardDescription>
            An ordered list. Drag a row to reorder it; changes stay on this device until you save
            the notes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {changes.fields.length === 0 ? (
            <p className="text-muted-foreground text-sm">No changes recorded yet.</p>
          ) : null}

          <ol className="space-y-2">
            {changes.fields.map((field, index) => (
              <li
                key={field.id}
                className={
                  draggingChangeId === field.id
                    ? "bg-muted/50 flex items-start gap-2 rounded-md"
                    : "flex items-start gap-2"
                }
                onDragOver={editable ? (event) => event.preventDefault() : undefined}
                onDrop={
                  editable
                    ? (event) => {
                        event.preventDefault();
                        const sourceId = event.dataTransfer.getData("text/plain") || draggingChangeId;
                        const sourceIndex = changes.fields.findIndex((change) => change.id === sourceId);
                        if (sourceIndex >= 0 && sourceIndex !== index) changes.move(sourceIndex, index);
                        setDraggingChangeId(null);
                      }
                    : undefined
                }
              >
                {editable ? (
                  <button
                    type="button"
                    draggable
                    title="Drag to reorder"
                    aria-label={`Drag change ${index + 1} to reorder`}
                    className="text-muted-foreground mt-1.5 flex w-7 shrink-0 cursor-grab items-center justify-center rounded-sm py-1 active:cursor-grabbing focus-visible:ring-2 focus-visible:outline-none"
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", field.id);
                      setDraggingChangeId(field.id);
                    }}
                    onDragEnd={() => setDraggingChangeId(null)}
                  >
                    <GripVertical className="size-4" aria-hidden />
                  </button>
                ) : (
                  <span
                    className="text-muted-foreground mt-2.5 flex w-7 shrink-0 items-center justify-center text-sm tabular-nums"
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                )}

                <div className="flex-1 space-y-1">
                  <Input
                    aria-label={`Change performed ${index + 1}`}
                    disabled={!editable}
                    placeholder="e.g. Dorsal reduction"
                    {...form.register(`changesPerformed.${index}.description`)}
                  />
                  <FieldError
                    errors={[form.formState.errors.changesPerformed?.[index]?.description]}
                  />
                </div>

                {editable ? (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive size-9"
                      onClick={() => changes.remove(index)}
                      aria-label={`Remove change ${index + 1}`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>

          {editable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => changes.append({ description: "" })}
            >
              <Plus aria-hidden />
              Add change
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Specific anatomical changes</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-2">
              <NoteField form={form} name="dorsum" label="Dorsum" rows={2} disabled={!editable} />
              <NoteField form={form} name="tip" label="Tip" rows={2} disabled={!editable} />
              <NoteField
                form={form}
                name="projection"
                label="Projection"
                rows={2}
                disabled={!editable}
              />
              <NoteField form={form} name="rotation" label="Rotation" rows={2} disabled={!editable} />
              <NoteField form={form} name="alar" label="Alar" rows={2} disabled={!editable} />
              <NoteField form={form} name="septum" label="Septum" rows={2} disabled={!editable} />
            </div>
            <NoteField
              form={form}
              name="otherAnatomicalChange"
              label="Other"
              rows={2}
              disabled={!editable}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assessment &amp; outcome</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <NoteField
              form={form}
              name="surgeonAssessment"
              label="Surgeon's assessment"
              rows={5}
              disabled={!editable}
            />
            <NoteField form={form} name="outcome" label="Outcome" rows={4} disabled={!editable} />
            <NoteField
              form={form}
              name="patientSatisfaction"
              label="Patient satisfaction"
              rows={3}
              disabled={!editable}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Complications &amp; revision</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <FieldSet>
              <FieldLabel asChild>
                <legend>Complications present</legend>
              </FieldLabel>
              <Controller
                control={form.control}
                name="complicationsPresent"
                render={({ field }) => (
                  <RadioGroup
                    disabled={!editable}
                    value={field.value === null ? "unknown" : field.value ? "yes" : "no"}
                    onValueChange={(value) =>
                      field.onChange(value === "unknown" ? null : value === "yes")
                    }
                    className="gap-3 pt-1"
                  >
                    {[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "unknown", label: "Not recorded" },
                    ].map((option) => (
                      <div key={option.value} className="flex items-center gap-2">
                        <RadioGroupItem value={option.value} id={`complications-${option.value}`} />
                        <FieldLabel
                          htmlFor={`complications-${option.value}`}
                          className="font-normal"
                        >
                          {option.label}
                        </FieldLabel>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              />
            </FieldSet>

            {complicationsPresent === true ? (
              <>
                <Field>
                  <FieldLabel htmlFor="complicationTypeId">Complication type</FieldLabel>
                  <Controller
                    control={form.control}
                    name="complicationTypeId"
                    render={({ field }) => (
                      <MasterDataCombobox
                        id="complicationTypeId"
                        table="complication_types"
                        label="Complication type"
                        value={field.value ?? null}
                        onValueChange={(id) => field.onChange(id)}
                        placeholder="Select or type a complication type"
                        disabled={!editable}
                        canCreate={can(role, "master_data:create")}
                      />
                    )}
                  />
                  <FieldDescription>
                    New types are saved and reused across cases.
                  </FieldDescription>
                </Field>

                <NoteField
                  form={form}
                  name="complicationDetails"
                  label="Complication details"
                  rows={3}
                  disabled={!editable}
                />
              </>
            ) : null}

            <FieldSet>
              <FieldLabel asChild>
                <legend>Revision required</legend>
              </FieldLabel>
              <Controller
                control={form.control}
                name="revisionRequired"
                render={({ field }) => (
                  <RadioGroup
                    disabled={!editable}
                    value={field.value === null ? "unknown" : field.value ? "yes" : "no"}
                    onValueChange={(value) =>
                      field.onChange(value === "unknown" ? null : value === "yes")
                    }
                    className="gap-3 pt-1"
                  >
                    {[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "unknown", label: "Not recorded" },
                    ].map((option) => (
                      <div key={option.value} className="flex items-center gap-2">
                        <RadioGroupItem value={option.value} id={`revision-${option.value}`} />
                        <FieldLabel htmlFor={`revision-${option.value}`} className="font-normal">
                          {option.label}
                        </FieldLabel>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              />
            </FieldSet>
          </FieldGroup>
        </CardContent>
      </Card>

      {editable ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || !dirty}>
            {pending ? <Spinner /> : <Save aria-hidden />}
            Save notes
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => form.reset()}
              disabled={pending}
            >
              Discard changes
            </Button>
          ) : null}
        </div>
      ) : null}
      <RequestEditDialog
        open={requesting}
        onOpenChange={setRequesting}
        caseId={detail.summary.id}
        scope="CASE_NOTES"
        sectionLabel="case notes"
      />
    </form>
  );
}

type NoteFieldName =
  | "patientConcern"
  | "preopAssessment"
  | "treatmentRecommendation"
  | "preopAestheticGoal"
  | "dorsum"
  | "tip"
  | "projection"
  | "rotation"
  | "alar"
  | "septum"
  | "otherAnatomicalChange"
  | "surgeonAssessment"
  | "outcome"
  | "patientSatisfaction"
  | "complicationDetails";

function NoteField({
  form,
  name,
  label,
  rows,
  disabled,
}: {
  form: NotesForm;
  name: NoteFieldName;
  label: string;
  rows: number;
  disabled: boolean;
}) {
  const error = form.formState.errors[name];

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Textarea
        id={name}
        rows={rows}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        {...form.register(name)}
      />
      <FieldError errors={[error]} />
    </Field>
  );
}
