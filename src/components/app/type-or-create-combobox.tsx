"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, ChevronsUpDown, Plus, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { normalizeMasterKey, validateMasterValue } from "@/lib/master-data";
import type { MasterValue } from "@/lib/types";

/**
 * The self-learning type-or-select control.
 *
 * The user can pick an existing value, type a new one, and create it inline
 * without ever visiting Settings. New values are persisted to master data and
 * become suggestions for every later case.
 *
 * Built entirely from shadcn primitives (Popover + Command + Button), so the
 * Radix keyboard and screen-reader behaviour is preserved as-is.
 */

export type TypeOrCreateComboboxProps = {
  label: string;
  value: string | null;
  onValueChange: (id: string | null, value: MasterValue | null) => void;
  searchAction: (query: string) => Promise<MasterValue[]>;
  createAction?: (displayName: string) => Promise<{ created: boolean; value: MasterValue }>;
  /** Pre-resolved selection, so an inactive historical value still renders. */
  selectedValue?: MasterValue | null;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
};

export function TypeOrCreateCombobox({
  label,
  value,
  onValueChange,
  searchAction,
  createAction,
  selectedValue = null,
  placeholder = "Select or type a value",
  emptyText = "No matches found.",
  disabled = false,
  invalid = false,
  id,
  className,
}: TypeOrCreateComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<MasterValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();
  const [selected, setSelected] = useState<MasterValue | null>(selectedValue);

  const requestId = useRef(0);

  useEffect(() => {
    setSelected(selectedValue);
  }, [selectedValue]);

  const runSearch = useCallback(
    async (term: string) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);

      try {
        const results = await searchAction(term);
        // Ignore a slow response that a newer keystroke has superseded.
        if (id !== requestId.current) return;
        setOptions(results);
      } catch {
        if (id !== requestId.current) return;
        setError("Could not load options.");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [searchAction],
  );

  useEffect(() => {
    if (!open) return;

    // Debounced so typing does not fire a query per keystroke.
    const timer = setTimeout(() => void runSearch(query), query ? 200 : 0);
    return () => clearTimeout(timer);
  }, [open, query, runSearch]);

  const validation = validateMasterValue(query);

  const existingMatch = useMemo(() => {
    const key = normalizeMasterKey(query);
    return key ? options.find((option) => option.normalized_key === key) : undefined;
  }, [options, query]);

  // Never offered for blank input, and never when the value already exists.
  const canCreate = Boolean(createAction) && validation.ok && !existingMatch;

  const select = (option: MasterValue) => {
    setSelected(option);
    onValueChange(option.id, option);
    setOpen(false);
    setQuery("");
  };

  const create = () => {
    if (!createAction || !validation.ok) return;

    startCreate(async () => {
      setError(null);

      try {
        const result = await createAction(validation.displayName);
        // `created: false` means a concurrent request won the race; selecting
        // the returned row is still exactly the right outcome.
        select(result.value);
      } catch {
        setError("Could not save that value.");
      }
    });
  };

  const displayLabel = selected?.display_name ?? "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          aria-invalid={invalid}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !displayLabel && "text-muted-foreground", className)}
        >
          <span className="truncate">
            {displayLabel || placeholder}
            {selected && !selected.is_active ? (
              <span className="text-muted-foreground ml-2 text-xs">(inactive)</span>
            ) : null}
          </span>
          <ChevronsUpDown className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        {/* Filtering happens server-side, so the built-in matcher is disabled. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={`Search ${label.toLowerCase()}...`}
            value={query}
            onValueChange={setQuery}
            onKeyDown={(event) => {
              // Enter creates only when there is nothing to highlight and the
              // typed text is genuinely new.
              if (event.key === "Enter" && canCreate && options.length === 0) {
                event.preventDefault();
                create();
              }
            }}
          />

          <CommandList>
            {loading ? (
              <div className="text-muted-foreground flex items-center gap-2 px-3 py-4 text-sm">
                <Spinner className="size-4" />
                Searching...
              </div>
            ) : null}

            {error ? (
              <div className="text-destructive flex items-center gap-2 px-3 py-4 text-sm">
                <TriangleAlert className="size-4" aria-hidden />
                {error}
              </div>
            ) : null}

            {!loading && !error && options.length === 0 && !canCreate ? (
              <CommandEmpty>{validation.ok ? emptyText : "Start typing to search."}</CommandEmpty>
            ) : null}

            {options.length > 0 ? (
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem key={option.id} value={option.id} onSelect={() => select(option)}>
                    <Check
                      className={cn("size-4", value === option.id ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    <span className="truncate">{option.display_name}</span>
                    {!option.is_active ? (
                      <span className="text-muted-foreground ml-auto text-xs">Inactive</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {canCreate ? (
              <CommandGroup>
                <CommandItem value={`__create__${query}`} onSelect={create} disabled={creating}>
                  {creating ? <Spinner className="size-4" /> : <Plus className="size-4" aria-hidden />}
                  <span className="truncate">
                    Create &ldquo;{validation.ok ? validation.displayName : query}&rdquo;
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}

            {!validation.ok && validation.reason === "too_long" ? (
              <div className="text-muted-foreground px-3 py-2 text-xs">
                That value is too long to save.
              </div>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
