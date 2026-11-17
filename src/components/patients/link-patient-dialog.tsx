"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { usePatientSearch } from "@/hooks/use-patient-search";
import { linkCaseToPatient } from "@/server/actions/patients";
import type { PatientSearchHit } from "@/server/queries/patients";

/** Admin: attach a case created before patients existed to its patient. */
export function LinkPatientDialog({
  open,
  onOpenChange,
  caseId,
  caseNumber,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  caseNumber: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PatientSearchHit | null>(null);
  const [pending, startTransition] = useTransition();
  const { hits, loading, error } = usePatientSearch(query);

  const submit = () => {
    if (!selected) return;
    startTransition(async () => {
      const result = await linkCaseToPatient({ caseId, patientId: selected.id });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(`${caseNumber} linked to ${selected.file_id}.`);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link {caseNumber} to a patient</DialogTitle>
          <DialogDescription>
            The case then appears in that patient&apos;s history. This cannot be undone from the app.
          </DialogDescription>
        </DialogHeader>

        <Command shouldFilter={false} className="border">
          <CommandInput
            placeholder="File ID, name or phone"
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setSelected(null);
            }}
          />
          <CommandList>
            {query.trim() && !loading ? (
              <CommandEmpty>{error ?? "No matching patient."}</CommandEmpty>
            ) : null}
            {loading && query.trim() ? (
              <div className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
                <Spinner /> Searching…
              </div>
            ) : null}
            {hits.length ? (
              <CommandGroup>
                {hits.map((hit) => (
                  <CommandItem
                    key={hit.id}
                    value={hit.id}
                    onSelect={() => setSelected(hit)}
                    data-checked={selected?.id === hit.id}
                  >
                    <span className="font-medium tabular-nums">{hit.file_id}</span>
                    <span className="truncate">{hit.full_name}</span>
                    {selected?.id === hit.id ? (
                      <span className="text-muted-foreground ml-auto text-xs">Selected</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!selected || pending}>
            {pending ? <Spinner /> : null}
            {selected ? `Link to ${selected.file_id}` : "Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
