"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type DoctorChoice = { id: string; display_name: string; branch_id: string | null };

const NONE = "__none__";

/** shadcn Select over active ADMIN/DOCTOR accounts (referral, surgeon, session doctor). */
export function DoctorSelect({
  id,
  doctors,
  value,
  onValueChange,
  placeholder = "Choose a doctor",
  allowNone = false,
  noneLabel = "Not recorded",
  disabled,
  invalid,
}: {
  id?: string;
  doctors: DoctorChoice[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <Select
      value={value ?? (allowNone ? NONE : undefined)}
      onValueChange={(next) => onValueChange(next === NONE ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone ? <SelectItem value={NONE}>{noneLabel}</SelectItem> : null}
        {doctors.map((doctor) => (
          <SelectItem key={doctor.id} value={doctor.id}>
            {doctor.display_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
