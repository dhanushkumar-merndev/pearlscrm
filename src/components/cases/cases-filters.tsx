"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListFilter, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MasterValue } from "@/lib/types";

/**
 * Filter controls for the cases list.
 *
 * Search stays on the page because it is the one control used constantly; the
 * remaining nine live behind a Filters dialog so the list is not pushed below
 * the fold by controls that are mostly left on "Any".
 *
 * Filter state lives entirely in the URL so the server can do the filtering and
 * a filtered view is shareable and restorable. Changes apply immediately, so
 * the dialog needs no separate draft state and closing it never discards work.
 * Search input is debounced — every keystroke must not trigger a query.
 */

const ANY = "__any__";

export function CasesFilters({
  procedures,
  procedureTypes,
  tags,
}: {
  procedures: MasterValue[];
  procedureTypes: MasterValue[];
  tags: MasterValue[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [searchTerm, setSearchTerm] = useState(searchParams.get("q") ?? "");
  const [open, setOpen] = useState(false);
  const firstRender = useRef(true);

  const apply = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === ANY) next.delete(key);
        else next.set(key, value);
      }

      // Any filter change returns to the first page of results.
      next.delete("page");

      startTransition(() => {
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    const timer = setTimeout(() => apply({ q: searchTerm || undefined }), 350);
    return () => clearTimeout(timer);
  }, [searchTerm, apply]);

  const value = (key: string) => searchParams.get(key) ?? ANY;

  const IGNORED = ["page", "pageSize", "sort", "direction"];

  /** Everything the user has narrowed by, including the search term. */
  const activeCount = [...searchParams.keys()].filter((key) => !IGNORED.includes(key)).length;

  /** Only what the dialog owns — the badge must not count the search box. */
  const filterCount = [...searchParams.keys()].filter(
    (key) => !IGNORED.includes(key) && key !== "q",
  ).length;

  const clearAll = () => {
    setSearchTerm("");
    startTransition(() => router.replace(pathname, { scroll: false }));
  };

  return (
    <Card>
      <CardContent>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="case-search">Search</Label>
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden
              />
              <Input
                id="case-search"
                className="pl-9"
                placeholder="Case ID, procedure or type"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <ListFilter aria-hidden />
                  Filters
                  {filterCount > 0 ? (
                    <Badge variant="secondary" className="ml-1 tabular-nums">
                      {filterCount}
                    </Badge>
                  ) : null}
                </Button>
              </DialogTrigger>

              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Filter cases</DialogTitle>
                  <DialogDescription>
                    Filters apply as you choose them. The list behind this dialog is already
                    updating.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FilterSelect
                    id="filter-procedure"
                    label="Procedure"
                    value={value("procedureId")}
                    onChange={(next) => apply({ procedureId: next })}
                    options={procedures.map((item) => ({
                      value: item.id,
                      label: item.display_name,
                    }))}
                  />

                  <FilterSelect
                    id="filter-procedure-type"
                    label="Procedure type"
                    value={value("procedureTypeId")}
                    onChange={(next) => apply({ procedureTypeId: next })}
                    options={procedureTypes.map((item) => ({
                      value: item.id,
                      label: item.display_name,
                    }))}
                  />

                  <FilterSelect
                    id="filter-status"
                    label="Case status"
                    value={searchParams.get("status") ?? "ACTIVE"}
                    onChange={(next) => apply({ status: next })}
                    anyLabel="All except archived"
                    options={[
                      { value: "ACTIVE", label: "Active" },
                      { value: "COMPLETED", label: "Completed" },
                      { value: "ARCHIVED", label: "Archived" },
                    ]}
                  />

                  <FilterSelect
                    id="filter-review"
                    label="Expert review"
                    value={value("reviewStatus")}
                    onChange={(next) => apply({ reviewStatus: next })}
                    options={[
                      { value: "PENDING", label: "Pending" },
                      { value: "IN_REVIEW", label: "In review" },
                      { value: "COMPLETED", label: "Completed" },
                    ]}
                  />

                  <FilterSelect
                    id="filter-consent"
                    label="Consent"
                    value={value("consent")}
                    onChange={(next) => apply({ consent: next })}
                    options={[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "not_recorded", label: "Not recorded" },
                    ]}
                  />

                  <FilterSelect
                    id="filter-followups"
                    label="Follow-ups"
                    value={value("hasFollowups")}
                    onChange={(next) => apply({ hasFollowups: next })}
                    options={[
                      { value: "yes", label: "Has follow-ups" },
                      { value: "no", label: "No follow-ups" },
                    ]}
                  />

                  <FilterSelect
                    id="filter-completion"
                    label="Completion"
                    value={value("completion")}
                    onChange={(next) => apply({ completion: next })}
                    options={[
                      { value: "complete", label: "Complete" },
                      { value: "incomplete", label: "Incomplete" },
                    ]}
                  />

                  <FilterSelect
                    id="filter-tag"
                    label="Tag"
                    value={value("tagId")}
                    onChange={(next) => apply({ tagId: next })}
                    options={tags.map((tag) => ({ value: tag.id, label: tag.display_name }))}
                  />

                  <div className="space-y-1.5">
                    <Label htmlFor="filter-from">Surgery from</Label>
                    <Input
                      id="filter-from"
                      type="date"
                      value={searchParams.get("surgeryFrom") ?? ""}
                      onChange={(event) => apply({ surgeryFrom: event.target.value || undefined })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="filter-to">Surgery to</Label>
                    <Input
                      id="filter-to"
                      type="date"
                      value={searchParams.get("surgeryTo") ?? ""}
                      onChange={(event) => apply({ surgeryTo: event.target.value || undefined })}
                    />
                  </div>
                </div>

                <DialogFooter className="sm:justify-between">
                  <Button variant="ghost" disabled={filterCount === 0} onClick={clearAll}>
                    <X aria-hidden />
                    Reset all
                  </Button>
                  <DialogClose asChild>
                    <Button>Done</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {activeCount > 0 ? (
              <Button variant="ghost" onClick={clearAll}>
                <X aria-hidden />
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  anyLabel = "Any",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  anyLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={anyLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{anyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
