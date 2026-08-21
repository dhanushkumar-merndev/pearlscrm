"use client";

import { useCallback, useEffect, useState } from "react";
import { ScrollText } from "lucide-react";

import { AuditDetails, formatAuditAction } from "@/components/audit/audit-details";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCached, setCached } from "@/lib/client-cache";
import { formatTimestamp } from "@/lib/dates";
import { getCaseAudit } from "@/server/actions/audit";
import type { CaseAuditPage } from "@/server/queries/audit";

/**
 * Case-level audit history. Append-only: normal users cannot alter it, and
 * details show changed field names rather than clinical content.
 */
export function CaseAuditTab({ caseId }: { caseId: string }) {
  const [result, setResult] = useState<CaseAuditPage | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const rows = result?.rows ?? null;

  // Cached per case *and* page, so paging back and forth — and returning to the
  // tab later — costs nothing. A hard refresh starts with an empty cache.
  const load = useCallback(
    async (signal: { cancelled: boolean }) => {
      const cacheKey = `case-audit:${caseId}:${page}`;
      const cached = getCached<CaseAuditPage>(cacheKey);

      if (cached) {
        setResult(cached);
        return;
      }

      const response = await getCaseAudit({ caseId, page });
      if (signal.cancelled) return;

      if (!response.ok) {
        setError(response.error.message);
        return;
      }

      setResult(response.data);
      setCached(cacheKey, response.data);
    },
    [caseId, page],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    // Fetch-on-mount and on page change. Every state update happens inside the
    // awaited `load`, never synchronously in this effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(signal);

    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit history</CardTitle>
        <CardDescription>
          Every recorded change to this case. Clinical narrative is never copied into the log.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        {rows === null && !error ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : null}

        {rows?.length === 0 ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ScrollText />
              </EmptyMedia>
              <EmptyTitle>No audit events yet</EmptyTitle>
              <EmptyDescription>Changes to this case will be recorded here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {rows && rows.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden md:table-cell">Entity</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatTimestamp(row.created_at)}
                    </TableCell>
                    <TableCell>{row.actor_name ?? "System"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatAuditAction(row.action)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{row.entity_type}</TableCell>
                    <TableCell className="w-full min-w-0">
                      <AuditDetails metadata={row.metadata} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {result && result.total > result.pageSize ? (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {`Showing ${(result.page - 1) * result.pageSize + 1}–${Math.min(
                result.page * result.pageSize,
                result.total,
              )} of ${result.total} events`}
            </p>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={result.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
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
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
