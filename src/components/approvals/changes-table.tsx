"use client";

import Link from "next/link";
import { ArrowRight, History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { formatTimestamp } from "@/lib/dates";
import type { ChangeEntry, ChangePage, FieldChange } from "@/server/queries/changes";

/**
 * What actually changed, and who changed it.
 *
 * Reads the `changes` object the audit log already records. Long values were
 * collapsed to `[N characters]` at write time, so a rewritten assessment shows
 * as a rewrite without the narrative ever leaving the case.
 */
export function ChangesTable({
  result,
  onPage,
}: {
  result: ChangePage;
  onPage: (page: number) => void;
}) {
  if (result.total === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyTitle>No field changes recorded yet</EmptyTitle>
          <EmptyDescription>
            Edits to case information, notes and follow-ups appear here with their before and
            after values.
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
              <TableHead className="whitespace-nowrap">When</TableHead>
              <TableHead className="whitespace-nowrap">Changed by</TableHead>
              <TableHead className="whitespace-nowrap">Case</TableHead>
              <TableHead className="whitespace-nowrap">Section</TableHead>
              <TableHead className="w-full min-w-0">What changed</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">
                  {formatTimestamp(row.created_at)}
                </TableCell>

                <TableCell className="whitespace-nowrap font-medium">
                  {row.actor_name ?? <span className="text-muted-foreground">System</span>}
                </TableCell>

                <TableCell className="whitespace-nowrap">
                  {row.case_id && row.case_number ? (
                    <Link href={`/cases/${row.case_id}`} className="hover:underline">
                      {row.case_number}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>

                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {sectionOf(row)}
                </TableCell>

                <TableCell className="w-full min-w-0">
                  <ChangeList changes={row.changes} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {result.total > result.pageSize ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {`Showing ${(result.page - 1) * result.pageSize + 1}–${Math.min(
              result.page * result.pageSize,
              result.total,
            )} of ${result.total} change${result.total === 1 ? "" : "s"}`}
          </p>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={result.page <= 1}
              onClick={() => onPage(result.page - 1)}
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
              onClick={() => onPage(result.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChangeList({ changes }: { changes: Record<string, FieldChange> }) {
  const entries = Object.entries(changes ?? {});

  if (entries.length === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {entries.map(([field, change]) => (
        <li key={field}>
          <Badge variant="outline" className="gap-1 font-normal whitespace-nowrap">
            <span className="text-muted-foreground">{humanize(field)}:</span>
            <span className="max-w-40 truncate line-through opacity-70">
              {render(change.from)}
            </span>
            <ArrowRight className="size-3 shrink-0" aria-hidden />
            <span className="max-w-40 truncate font-medium">{render(change.to)}</span>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** Which part of the case an audit action belongs to. */
function sectionOf(row: ChangeEntry): string {
  switch (row.action) {
    case "CASE_UPDATED":
      return "Case information";
    case "CASE_NOTES_UPDATED":
      return "Case notes";
    case "FOLLOWUP_UPDATED":
      return "Follow-up";
    case "REVIEW_UPDATED":
    case "REVIEW_COMPLETED":
      return "Expert review";
    case "CONSENT_CHANGED":
      return "Consent";
    default:
      return humanize(row.entity_type);
  }
}

function render(value: unknown): string {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function humanize(value: string): string {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
