"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { usePatientSearch } from "@/hooks/use-patient-search";
import { normalizeFileIdInput } from "@/lib/file-id";

/**
 * Ctrl/⌘K: type a File ID ("kl12" → KL0012), a name or a phone, and jump to
 * the patient's full history. Any doctor, any branch.
 */
export function PatientSearchCommand() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { hits, loading, error } = usePatientSearch(open ? query : "");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (id: string) => {
    setOpen(false);
    setQuery("");
    router.push(`/patients/${id}`);
  };

  const exact = normalizeFileIdInput(query);

  return (
    <>
      <Button
        variant="outline"
        className="text-muted-foreground h-9 w-full max-w-72 justify-start gap-2 font-normal"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden />
        <span className="truncate">Find patient by File ID…</span>
        <Kbd className="ml-auto hidden sm:inline-flex">⌘K</Kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
        title="Find patient"
        description="Search by File ID, name or phone"
      >
        {/* Results come pre-filtered from the server; cmdk must not re-filter
            them by item value (a UUID). */}
        <Command shouldFilter={false}>
        <CommandInput placeholder="File ID (KL12), name or phone" value={query} onValueChange={setQuery} />
        <CommandList>
          {!query.trim() ? (
            <p className="text-muted-foreground p-4 text-sm">
              Type a File ID like <span className="font-medium">BG1</span> or <span className="font-medium">KL0012</span>.
            </p>
          ) : loading ? (
            <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
              <Spinner /> Searching…
            </div>
          ) : (
            <CommandEmpty>{error ?? (exact ? `No patient ${exact}.` : "No matching patient.")}</CommandEmpty>
          )}
          {hits.length > 0 && !loading ? (
            <CommandGroup heading="Patients">
              {hits.map((hit) => (
                <CommandItem key={hit.id} value={hit.id} onSelect={() => go(hit.id)}>
                  <UserRound aria-hidden />
                  <span className="font-medium tabular-nums">{hit.file_id}</span>
                  <span className="truncate">{hit.full_name}</span>
                  <span className="text-muted-foreground ml-auto truncate text-xs">
                    {hit.referred_for_name ?? ""}
                    {hit.active_treatments > 0 ? ` · ${hit.active_treatments} active` : ""}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
