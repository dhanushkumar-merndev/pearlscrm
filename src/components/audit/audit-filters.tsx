"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Filter controls for the audit log.
 *
 * Like the cases list, every filter lives in the URL so the server performs the
 * query and a filtered view is shareable and restorable.
 */

const ANY = "__any__";

const ENTITY_TYPES = [
  { value: "case", label: "Case" },
  { value: "case_visit", label: "Visit" },
  { value: "clinical_image", label: "Clinical image" },
  { value: "image_upload_session", label: "Image upload" },
  { value: "case_notes", label: "Case notes" },
  { value: "case_consent", label: "Consent" },
  { value: "case_review", label: "Expert review" },
  { value: "profile", label: "User" },
  { value: "master_value", label: "Master data" },
];

export function AuditFilters({
  actions,
  users,
}: {
  actions: string[];
  users: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const apply = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === ANY) next.delete(key);
        else next.set(key, value);
      }

      next.delete("page");

      startTransition(() => {
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  const value = (key: string) => searchParams.get(key) ?? ANY;
  const activeCount = [...searchParams.keys()].filter((key) => !["page", "pageSize"].includes(key))
    .length;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            {activeCount > 0 ? `${activeCount} filter${activeCount === 1 ? "" : "s"} active` : "All events"}
          </p>

          {activeCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}
            >
              <X aria-hidden />
              Clear filters
            </Button>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            id="filter-action"
            label="Action"
            value={value("action")}
            onChange={(next) => apply({ action: next })}
            options={actions.map((action) => ({
              value: action,
              label: action.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
            }))}
          />

          <FilterSelect
            id="filter-actor"
            label="User"
            value={value("actorId")}
            onChange={(next) => apply({ actorId: next })}
            options={users.map((user) => ({ value: user.id, label: user.name }))}
          />

          <FilterSelect
            id="filter-entity"
            label="Entity"
            value={value("entityType")}
            onChange={(next) => apply({ entityType: next })}
            options={ENTITY_TYPES}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="filter-from">From</Label>
              <Input
                id="filter-from"
                type="date"
                value={searchParams.get("from") ?? ""}
                onChange={(event) => apply({ from: event.target.value || undefined })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-to">To</Label>
              <Input
                id="filter-to"
                type="date"
                value={searchParams.get("to") ?? ""}
                onChange={(event) => apply({ to: event.target.value || undefined })}
              />
            </div>
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Any" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any</SelectItem>
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
