"use client";

import { MasterDataCombobox } from "@/components/app/master-data-combobox";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { todayIsoDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import type { RoleCode } from "@/lib/types";

export type PlanState = {
  procedureId: string;
  procedureTypeId: string;
  mode: "SURGICAL" | "SESSIONS";
  plannedSessions: string;
  startDate: string;
};

export const emptyPlan: PlanState = {
  procedureId: "",
  procedureTypeId: "",
  mode: "SESSIONS",
  plannedSessions: "",
  startDate: todayIsoDate(),
};

/** Whether the user started filling the plan (an empty plan is simply skipped). */
export function planIsFilled(plan: PlanState): boolean {
  return Boolean(plan.procedureId || plan.procedureTypeId || plan.plannedSessions);
}

/**
 * Procedure + how it is delivered. Session treatments (laser, peels…) need a
 * session count and start date; surgical ones are created as Planned and get
 * their date through Mark for Surgery, which also schedules the reminders.
 */
export function TreatmentPlanFields({
  value,
  onChange,
  role,
  error,
  idPrefix = "plan",
}: {
  value: PlanState;
  onChange: (next: PlanState) => void;
  role: RoleCode;
  error?: string | null;
  idPrefix?: string;
}) {
  const set = (patch: Partial<PlanState>) => onChange({ ...value, ...patch });
  const canCreate = can(role, "master_data:create");

  return (
    <FieldGroup>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-procedure`}>Procedure</FieldLabel>
        <MasterDataCombobox
          id={`${idPrefix}-procedure`}
          table="procedures"
          label="Procedure"
          value={value.procedureId || null}
          onValueChange={(id, picked) =>
            // Preselect how this procedure is usually delivered; still changeable.
            set({ procedureId: id ?? "", ...(picked?.default_mode ? { mode: picked.default_mode } : {}) })
          }
          placeholder="e.g. Laser Hair Removal, Rhinoplasty"
          canCreate={canCreate}
        />
      </Field>

      <FieldSet>
        <FieldLegend variant="label">Delivered as</FieldLegend>
        <RadioGroup
          value={value.mode}
          onValueChange={(mode) => set({ mode: mode as PlanState["mode"] })}
          className="grid gap-2 sm:grid-cols-2"
        >
          <Label className="has-data-[state=checked]:border-primary flex items-start gap-3 rounded-md border p-3 font-normal">
            <RadioGroupItem value="SESSIONS" id={`${idPrefix}-mode-sessions`} className="mt-0.5" />
            <span>
              <span className="block font-medium">Sessions</span>
              <span className="text-muted-foreground text-xs">Before &amp; After photos every session</span>
            </span>
          </Label>
          <Label className="has-data-[state=checked]:border-primary flex items-start gap-3 rounded-md border p-3 font-normal">
            <RadioGroupItem value="SURGICAL" id={`${idPrefix}-mode-surgical`} className="mt-0.5" />
            <span>
              <span className="block font-medium">Surgery</span>
              <span className="text-muted-foreground text-xs">Standard views, follow-ups, reminders</span>
            </span>
          </Label>
        </RadioGroup>
      </FieldSet>

      {value.mode === "SESSIONS" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-sessions`}>Sessions needed</FieldLabel>
            <Input
              id={`${idPrefix}-sessions`}
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              value={value.plannedSessions}
              onChange={(event) => set({ plannedSessions: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-start`}>Start date</FieldLabel>
            <Input
              id={`${idPrefix}-start`}
              type="date"
              value={value.startDate}
              onChange={(event) => set({ startDate: event.target.value })}
            />
          </Field>
        </div>
      ) : (
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-type`}>Procedure type</FieldLabel>
          <MasterDataCombobox
            id={`${idPrefix}-type`}
            table="procedure_types"
            label="Procedure type"
            value={value.procedureTypeId || null}
            onValueChange={(id) => set({ procedureTypeId: id ?? "" })}
            placeholder="Primary or Revision"
            canCreate={canCreate}
          />
          <FieldDescription>
            Saved as Planned. Use Mark for Surgery on the treatment to set the date and reminders.
          </FieldDescription>
        </Field>
      )}
    </FieldGroup>
  );
}
