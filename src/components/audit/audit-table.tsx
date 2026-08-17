"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ScrollText } from "lucide-react";

import { AuditDetails, formatAuditAction } from "@/components/audit/audit-details";
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
import type { AuditListResult } from "@/server/queries/audit";

/**
 * Audit log table.
 *
 * Pagination is URL-driven and executed in PostgreSQL; the client only holds
 * the current page. Details render through `AuditDetails`, which refuses to
 * show anything that looks like a secret or internal identifier.
 */

export function AuditTable({ result }: { result: AuditListResult }) {
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

  if (result.rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ScrollText />
          </EmptyMedia>
          <EmptyTitle>No audit events found</EmptyTitle>
          <EmptyDescription>
            {[...searchParams.keys()].length > 0
              ? "No events match the current filters. Try widening your search."
              : "No activity has been recorded yet."}
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
              <TableHead>Timestamp</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="hidden md:table-cell">Case</TableHead>
              <TableHead className="hidden lg:table-cell">Entity</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">
                  {formatTimestamp(row.created_at)}
                </TableCell>

                <TableCell className="max-w-40 truncate">
                  {row.actor_name ?? <span className="text-muted-foreground">System</span>}
                </TableCell>

                <TableCell className="font-medium">{formatAuditAction(row.action)}</TableCell>

                <TableCell className="hidden md:table-cell">
                  {row.case_number ?? <span className="text-muted-foreground">—</span>}
                </TableCell>

                <TableCell className="hidden lg:table-cell">
                  <span className="text-muted-foreground">{row.entity_type}</span>
                </TableCell>

                <TableCell>
                  <AuditDetails metadata={row.metadata} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {`Showing ${(result.page - 1) * result.pageSize + 1}–${Math.min(
            result.page * result.pageSize,
            result.total,
          )} of ${result.total} event${result.total === 1 ? "" : "s"}`}
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
