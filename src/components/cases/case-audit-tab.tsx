"use client";

import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";

import { AuditDetails, formatAuditAction } from "@/components/audit/audit-details";
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
import { formatTimestamp } from "@/lib/dates";
import { getCaseAudit } from "@/server/actions/audit";
import type { AuditLogRow } from "@/server/queries/audit";

/**
 * Case-level audit history. Append-only: normal users cannot alter it, and
 * details show changed field names rather than clinical content.
 */
export function CaseAuditTab({ caseId }: { caseId: string }) {
  const [rows, setRows] = useState<AuditLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getCaseAudit({ caseId }).then((result) => {
      if (cancelled) return;
      if (!result.ok) setError(result.error.message);
      else setRows(result.data);
    });

    return () => {
      cancelled = true;
    };
  }, [caseId]);

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
                    <TableCell>
                      <AuditDetails metadata={row.metadata} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
