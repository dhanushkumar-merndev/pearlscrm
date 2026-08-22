"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatClinicDate } from "@/lib/dates";
import { normalizeMasterKey } from "@/lib/master-data";
import {
  createMasterValueAction,
  pageMasterValuesAction,
  setMasterValueActiveAction,
} from "@/server/actions/master-data";
import type { MasterValuePage } from "@/server/services/master-data";
import type { MasterTable } from "@/lib/types";

export type Section = {
  table: MasterTable;
  label: string;
  description: string;
  initial: MasterValuePage;
};

/** Long enough that typing a word is one query, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 250;

export function MasterDataSection({ section }: { section: Section }) {
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [newValue, setNewValue] = useState("");
  const [page, setPage] = useState(section.initial);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Guards against an earlier, slower query overwriting a later one.
  const requestId = useRef(0);

  /**
   * Search and paging run in the database. Filtering a fixed slice in the
   * browser silently hides everything past the cap, which on a table of several
   * hundred procedures reads as "that value does not exist".
   */
  const load = useCallback(
    async (query: string, pageNumber: number) => {
      const id = (requestId.current += 1);
      setLoading(true);

      const result = await pageMasterValuesAction({
        table: section.table,
        query,
        includeInactive: true,
        page: pageNumber,
        pageSize: section.initial.pageSize,
      });

      if (id !== requestId.current) return;

      setLoading(false);

      if (!result.ok) {
        setLoadError(result.error.message);
        return;
      }

      setLoadError(null);
      setPage(result.data);
    },
    [section.table, section.initial.pageSize],
  );

  // Debounced so a typed word is one round trip rather than one per keystroke.
  useEffect(() => {
    if (search === "") {
      // The first page with no query is what the server already rendered.
      if (requestId.current === 0) return;
    }

    const timer = window.setTimeout(() => void load(search, 1), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, load]);

  const refresh = useCallback(() => {
    void load(search, page.page);
  }, [load, search, page.page]);

  const duplicate = useMemo(() => {
    const key = normalizeMasterKey(newValue);
    return key ? page.rows.some((value) => value.normalized_key === key) : false;
  }, [page.rows, newValue]);

  const create = () => {
    startTransition(async () => {
      const result = await createMasterValueAction({
        table: section.table,
        displayName: newValue,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success(
        result.data.created
          ? `Added \u201c${result.data.value.display_name}\u201d`
          : `\u201c${result.data.value.display_name}\u201d already existed`,
      );
      setNewValue("");
      refresh();
    });
  };

  const toggle = (
    value: { id: string; display_name: string },
    isActive: boolean,
  ) => {
    startTransition(async () => {
      const result = await setMasterValueActiveAction({
        table: section.table,
        id: value.id,
        isActive,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success(isActive ? "Value enabled" : "Value disabled");
      refresh();
    });
  };

  const busy = pending || loading;
  const first = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const last = Math.min(page.page * page.pageSize, page.total);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.label}</CardTitle>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`search-${section.table}`}>Search</Label>
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden
              />
              <Input
                id={`search-${section.table}`}
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${section.label.toLowerCase()}`}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`add-${section.table}`}>Add a value</Label>
            <div className="flex gap-2">
              <Input
                id={`add-${section.table}`}
                value={newValue}
                onChange={(event) => setNewValue(event.target.value)}
                placeholder="New value"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && newValue.trim() && !duplicate) {
                    event.preventDefault();
                    create();
                  }
                }}
              />
              <Button onClick={create} disabled={busy || !newValue.trim() || duplicate}>
                {pending ? <Spinner /> : <Plus aria-hidden />}
                Add
              </Button>
            </div>
            {duplicate ? (
              <p className="text-muted-foreground text-xs">That value already exists.</p>
            ) : null}
          </div>
        </div>

        {loadError ? (
          <p className="text-destructive text-sm" role="alert">
            {loadError}
          </p>
        ) : null}

        {page.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {search ? "No values match your search." : "No values yet."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border" aria-busy={loading}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Value</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  <TableHead className="hidden md:table-cell">Usage</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {page.rows.map((value) => (
                  <TableRow key={value.id}>
                    <TableCell className="font-medium">
                      {value.display_name}
                      {!value.is_active ? (
                        <Badge variant="outline" className="text-muted-foreground ml-2">
                          Inactive
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">
                      {formatClinicDate(value.created_at.slice(0, 10))}
                    </TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">
                      {value.usage_count}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={value.is_active}
                        disabled={busy}
                        aria-label={`${value.display_name} active`}
                        onCheckedChange={(checked) => toggle(value, checked)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm tabular-nums">
            {page.total === 0
              ? "No values"
              : `Showing ${first}\u2013${last} of ${page.total}${search ? " matching" : ""}`}
          </p>

          {page.pageCount > 1 ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || page.page <= 1}
                onClick={() => void load(search, page.page - 1)}
              >
                Previous
              </Button>
              <span className="text-muted-foreground text-sm tabular-nums">
                Page {page.page} of {page.pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || page.page >= page.pageCount}
                onClick={() => void load(search, page.page + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>

        <p className="text-muted-foreground text-xs">
          Values in use cannot be deleted. Disabling one stops it appearing in dropdowns for new
          records while keeping historical cases readable.
        </p>
      </CardContent>
    </Card>
  );
}
