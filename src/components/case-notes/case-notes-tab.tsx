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
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";

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
import { cn } from "@/lib/utils";
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
const dropAnimationConfig: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: "0.4",
      },
    },
  }),
};

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
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = changes.fields.findIndex((item) => item.id === active.id);
      const newIndex = changes.fields.findIndex((item) => item.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        changes.move(oldIndex, newIndex);
      }
    }
    setActiveId(null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  const activeIndex = changes.fields.findIndex((item) => item.id === activeId);

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
            An ordered list. Drag a row handle to reorder it; changes stay on this device until you
            save the notes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {changes.fields.length === 0 ? (
            <p className="text-muted-foreground text-sm">No changes recorded yet.</p>
          ) : null}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={changes.fields.map((field) => field.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">
                {changes.fields.map((field, index) => (
                  <SortableChangeRow
                    key={field.id}
                    fieldId={field.id}
                    index={index}
                    editable={editable}
                    form={form}
                    onRemove={() => changes.remove(index)}
                  />
                ))}
              </ul>
            </SortableContext>

            <DragOverlay dropAnimation={dropAnimationConfig}>
              {activeId && activeIndex >= 0 ? (
                <div className="bg-background/95 border-primary/40 ring-primary/20 flex items-start gap-2.5 rounded-lg border p-1 shadow-2xl ring-2 backdrop-blur-md">
                  <div className="text-primary bg-primary/10 mt-1 flex size-8 shrink-0 cursor-grabbing items-center justify-center rounded-md">
                    <GripVertical className="size-4" aria-hidden />
                  </div>
                  <div className="flex-1">
                    <Input
                      readOnly
                      tabIndex={-1}
                      value={form.getValues(`changesPerformed.${activeIndex}.description`) || ""}
                      placeholder="e.g. Dorsal reduction"
                      className="bg-background shadow-xs pointer-events-none"
                    />
                  </div>
                  <div className="size-9 shrink-0" />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

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

function SortableChangeRow({
  fieldId,
  index,
  editable,
  form,
  onRemove,
}: {
  fieldId: string;
  index: number;
  editable: boolean;
  form: NotesForm;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: fieldId,
    disabled: !editable,
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex items-start gap-2.5 rounded-lg border border-transparent p-1 transition-[background-color,border-color,opacity,shadow] duration-150",
        isDragging
          ? "border-primary/40 bg-primary/5 opacity-30 border-dashed shadow-inner"
          : "hover:border-border/40 hover:bg-muted/20"
      )}
    >
      {editable ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          aria-label={`Drag change ${index + 1} to reorder`}
          className="text-muted-foreground/60 hover:text-foreground hover:bg-muted active:text-foreground active:bg-muted active:cursor-grabbing mt-1 flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md transition-all duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      ) : (
        <span
          className="text-muted-foreground mt-2 flex size-8 shrink-0 items-center justify-center text-sm font-medium tabular-nums"
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
          className="bg-background transition-colors focus-visible:border-primary"
          {...form.register(`changesPerformed.${index}.description`)}
        />
        <FieldError
          errors={[form.formState.errors.changesPerformed?.[index]?.description]}
        />
      </div>

      {editable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 mt-0.5 size-9 shrink-0 rounded-md transition-colors"
          onClick={onRemove}
          aria-label={`Remove change ${index + 1}`}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}
