"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { todayIsoDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { updateCase } from "@/server/actions/cases";
import type { CaseListRow, MasterValue, RoleCode } from "@/lib/types";

/**
 * Edits the case's own details.
 *
 * The dialog only opens once the server has confirmed an editing pass is open,
 * and the save consumes the approval that authorized it. Optimistic concurrency
 * still applies: a stale version is refused rather than overwriting whatever
 * someone else saved in the meantime.
 */
export function EditCaseDialog({
  open,
  onOpenChange,
  summary,
  tags,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: CaseListRow;
  tags: MasterValue[];
  role: RoleCode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [procedureId, setProcedureId] = useState(summary.procedure_id);
  const [procedureTypeId, setProcedureTypeId] = useState(summary.procedure_type_id);
  const [surgeryDate, setSurgeryDate] = useState(summary.surgery_date);
  const [followupAvailability, setFollowupAvailability] = useState(
    summary.followup_availability ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const canCreateMasterData = can(role, "master_data:create");

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (next) {
      setProcedureId(summary.procedure_id);
      setProcedureTypeId(summary.procedure_type_id);
      setSurgeryDate(summary.surgery_date);
      setFollowupAvailability(summary.followup_availability ?? "");
      setError(null);
    }
  };

  const submit = () => {
    setError(null);

    startTransition(async () => {
      const result = await updateCase({
        caseId: summary.id,
        procedureId,
        procedureTypeId,
        surgeryDate,
        followupAvailability,
        tagIds: tags.map((tag) => tag.id),
        expectedVersion: summary.version,
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      toast.success("Case information updated");
      onOpenChange(false);
      router.refresh();
    });
  };

  const valid = procedureId !== "" && procedureTypeId !== "" && surgeryDate !== "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit case information</DialogTitle>
          <DialogDescription>
            Saving closes the approved editing pass. Any further change needs a new approval.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <Field>
            <FieldLabel htmlFor="edit-procedure">Procedure</FieldLabel>
            <MasterDataCombobox
              id="edit-procedure"
              table="procedures"
              label="Procedure"
              value={procedureId || null}
              onValueChange={(id) => setProcedureId(id ?? "")}
              placeholder="Select or type a procedure"
              canCreate={canCreateMasterData}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="edit-procedure-type">Procedure type</FieldLabel>
            <MasterDataCombobox
              id="edit-procedure-type"
              table="procedure_types"
              label="Procedure type"
              value={procedureTypeId || null}
              onValueChange={(id) => setProcedureTypeId(id ?? "")}
              placeholder="Primary or Revision"
              canCreate={canCreateMasterData}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="edit-surgery-date">Date of surgery</FieldLabel>
            <Input
              id="edit-surgery-date"
              type="date"
              max={todayIsoDate()}
              value={surgeryDate}
              onChange={(event) => setSurgeryDate(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="edit-followup-availability">Follow-up availability</FieldLabel>
            <Input
              id="edit-followup-availability"
              value={followupAvailability}
              onChange={(event) => setFollowupAvailability(event.target.value)}
              placeholder="e.g. 1M / 3M / 6M / 12M"
            />
            <FieldDescription>
              A note on which follow-ups are expected. Actual visits are recorded separately.
            </FieldDescription>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !valid}>
            {pending ? <Spinner /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
