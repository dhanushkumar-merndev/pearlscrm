"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown, FolderOpen } from "lucide-react";

import {
  CaseStatusBadge,
  ConsentBadge,
  ImageCompletionBadge,
  ReviewBadge,
} from "@/components/app/status-badges";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatClinicDate } from "@/lib/dates";
import type { CaseListQuery } from "@/lib/validation/schemas";
import type { CaseListResult } from "@/server/queries/cases";

/**
 * Cases table.
 *
 * Sorting and pagination are URL-driven and executed in PostgreSQL — the client
 * only ever holds the current page.
 */

const SORTABLE = {
  case_number: "Case ID",
  surgery_date: "Surgery Date",
  latest_followup_date: "Latest Follow-up",
  created_at: "Created",
} as const;

export function CasesTable({ result, query }: { result: CaseListResult; query: CaseListQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const navigate = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const toggleSort = (column: keyof typeof SORTABLE) => {
    const isCurrent = query.sort === column;
    navigate({
      sort: column,
      direction: isCurrent && query.direction === "desc" ? "asc" : "desc",
      page: undefined,
    });
  };

  if (result.rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderOpen />
          </EmptyMedia>
          <EmptyTitle>No cases found</EmptyTitle>
          <EmptyDescription>
            {[...searchParams.keys()].length > 0
              ? "No cases match the current filters. Try widening your search."
              : "No cases yet. Create the first clinical case."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader column="case_number" query={query} onSort={toggleSort} />
              <TableHead>Procedure</TableHead>
              <TableHead className="hidden md:table-cell">Type</TableHead>
              <SortHeader column="surgery_date" query={query} onSort={toggleSort} className="hidden lg:table-cell" />
              <SortHeader
                column="latest_followup_date"
                query={query}
                onSort={toggleSort}
                className="hidden lg:table-cell"
              />
              <TableHead className="hidden xl:table-cell">Consent</TableHead>
              <TableHead className="hidden xl:table-cell">Before images</TableHead>
              <TableHead>Expert review</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  <Link href={`/cases/${row.id}`} className="hover:underline">
                    {row.case_number}
                  </Link>
                </TableCell>

                <TableCell className="max-w-48 truncate">{row.procedure_name}</TableCell>

                <TableCell className="hidden md:table-cell">{row.procedure_type_name}</TableCell>

                <TableCell className="hidden tabular-nums lg:table-cell">
                  {formatClinicDate(row.surgery_date)}
                </TableCell>

                <TableCell className="hidden lg:table-cell">
                  {row.latest_followup_label ? (
                    <span className="flex flex-col">
                      <span>{row.latest_followup_label}</span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {formatClinicDate(row.latest_followup_date)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </TableCell>

                <TableCell className="hidden xl:table-cell">
                  <ConsentBadge
                    state={
                      row.image_use_consent === null
                        ? "NOT_RECORDED"
                        : row.image_use_consent
                          ? "YES"
                          : "NO"
                    }
                  />
                </TableCell>

                <TableCell className="hidden xl:table-cell">
                  <ImageCompletionBadge
                    resolved={(row.before_uploaded_count ?? 0) + (row.before_not_available_count ?? 0)}
                    total={row.standard_view_count}
                  />
                </TableCell>

                <TableCell>
                  <ReviewBadge status={row.review_status} />
                </TableCell>

                <TableCell>
                  <CaseStatusBadge status={row.archived_at ? "ARCHIVED" : row.status} />
                </TableCell>

                <TableCell className="text-right">
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/cases/${row.id}`}>Open</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {result.total === 0
            ? "No cases"
            : `Showing ${(result.page - 1) * result.pageSize + 1}–${Math.min(
                result.page * result.pageSize,
                result.total,
              )} of ${result.total} case${result.total === 1 ? "" : "s"}`}
        </p>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={result.page <= 1}
            onClick={() => navigate({ page: String(result.page - 1) })}
          >
            Previous
          </Button>
          <span className="text-muted-foreground text-sm tabular-nums">
            Page {result.page} of {result.pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={result.page >= result.pageCount}
            onClick={() => navigate({ page: String(result.page + 1) })}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function SortHeader({
  column,
  query,
  onSort,
  className,
}: {
  column: keyof typeof SORTABLE;
  query: CaseListQuery;
  onSort: (column: keyof typeof SORTABLE) => void;
  className?: string;
}) {
  const active = query.sort === column;
  const Icon = !active ? ChevronsUpDown : query.direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <TableHead className={className} aria-sort={active ? (query.direction === "asc" ? "ascending" : "descending") : "none"}>
      <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2" onClick={() => onSort(column)}>
        {SORTABLE[column]}
        <Icon className="size-3.5 opacity-60" aria-hidden />
      </Button>
    </TableHead>
  );
}
