"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { EditRequestBadge } from "@/components/app/status-badges";
import { ChangesTable } from "@/components/approvals/changes-table";
import { DecideRequestDialog } from "@/components/approvals/decide-request-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTimestamp } from "@/lib/dates";
import type { ChangePage } from "@/server/queries/changes";
import type { EditRequestPage } from "@/server/queries/notifications";
import type { CaseEditRequestRow } from "@/lib/types";

/** How a scope is described to the administrator deciding on it. */
export function describeScope(request: CaseEditRequestRow): string {
  if (request.scope === "CASE_INFORMATION") return "Case information";
  if (request.scope === "CASE_NOTES") return "Case notes";
  if (request.scope === "VISIT_DETAILS") return `${request.visit_label ?? "Visit"} details`;
  return `${request.visit_label ?? "Visit"} images`;
}

/**
 * The administrator's approval queue.
 *
 * Pending requests come first, oldest at the top — this is a queue of people
 * waiting, not a feed. The decided list is kept alongside it so a decision can
 * be traced without opening the audit log.
 */
export function ApprovalsPanel({
  pending,
  decided,
  changes,
}: {
  pending: EditRequestPage;
  decided: EditRequestPage;
  changes: ChangePage;
}) {
  const [target, setTarget] = useState<CaseEditRequestRow | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Page state lives in the URL so a decision's `router.refresh()` returns to
  // the same page rather than snapping back to the first.
  const goToPage = (param: string, page: number) => {
    const next = new URLSearchParams(searchParams.toString());
    if (page <= 1) next.delete(param);
    else next.set(param, String(page));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <>
      <Tabs defaultValue="pending" className="gap-4">
        <TabsList>
          <TabsTrigger value="pending">
            Awaiting decision
            {pending.total > 0 ? (
              <span className="text-muted-foreground ml-1 tabular-nums">({pending.total})</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="decided">Decided</TabsTrigger>
          <TabsTrigger value="changes">
            Changes
            {changes.total > 0 ? (
              <span className="text-muted-foreground ml-1 tabular-nums">({changes.total})</span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          {pending.total === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ShieldCheck />
                </EmptyMedia>
                <EmptyTitle>Nothing is waiting for approval.</EmptyTitle>
                <EmptyDescription>
                  Requests to reopen a submitted section appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Requests awaiting a decision</CardTitle>
                <CardDescription>Oldest first.</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <RequestTable rows={pending.rows} onDecide={setTarget} />
                <Pager result={pending} onPage={(page) => goToPage("pendingPage", page)} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="decided">
          {decided.total === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No decisions have been recorded yet.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Decided requests</CardTitle>
                <CardDescription>Most recently updated first.</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <RequestTable rows={decided.rows} />
                <Pager result={decided} onPage={(page) => goToPage("decidedPage", page)} />
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="changes">
          <Card>
            <CardHeader>
              <CardTitle>What changed</CardTitle>
              <CardDescription>
                Field-level edits across every case, newest first — who changed it and the value
                before and after. Long clinical text is recorded as its length, never its content.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChangesTable
                result={changes}
                onPage={(page) => goToPage("changesPage", page)}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <DecideRequestDialog
        request={target}
        onOpenChange={(open) => !open && setTarget(null)}
      />
    </>
  );
}

function RequestTable({
  rows,
  onDecide,
}: {
  rows: CaseEditRequestRow[];
  onDecide?: (request: CaseEditRequestRow) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Case</TableHead>
            <TableHead>Section</TableHead>
            <TableHead>Requested by</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Requested</TableHead>
            <TableHead>Status</TableHead>
            {onDecide ? <TableHead className="text-right">Action</TableHead> : null}
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((request) => (
            <TableRow key={request.id}>
              <TableCell className="font-medium">
                <Link href={`/cases/${request.case_id}`} className="hover:underline">
                  {request.case_number}
                </Link>
              </TableCell>
              <TableCell>{describeScope(request)}</TableCell>
              <TableCell>{request.requested_by_name ?? "Unknown user"}</TableCell>
              <TableCell className="max-w-80 min-w-56 text-sm whitespace-pre-line">
                {request.reason}
              </TableCell>
              <TableCell className="tabular-nums whitespace-nowrap">
                {formatTimestamp(request.requested_at)}
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <EditRequestBadge status={request.status} />
                  {request.decided_by_name ? (
                    <p className="text-muted-foreground text-xs">
                      by {request.decided_by_name}
                      {request.decided_at ? ` · ${formatTimestamp(request.decided_at)}` : ""}
                    </p>
                  ) : null}
                  {request.decision_note ? (
                    <p className="text-muted-foreground text-xs">{request.decision_note}</p>
                  ) : null}
                </div>
              </TableCell>
              {onDecide ? (
                <TableCell className="text-right">
                  <Button size="sm" onClick={() => onDecide(request)}>
                    Review
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Shared pager for both lists. Hidden while everything fits on one page. */
function Pager({
  result,
  onPage,
}: {
  result: EditRequestPage;
  onPage: (page: number) => void;
}) {
  if (result.total <= result.pageSize) return null;

  return (
    <div className="flex flex-col gap-3 px-6 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {`Showing ${(result.page - 1) * result.pageSize + 1}–${Math.min(
          result.page * result.pageSize,
          result.total,
        )} of ${result.total} request${result.total === 1 ? "" : "s"}`}
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
  );
}
