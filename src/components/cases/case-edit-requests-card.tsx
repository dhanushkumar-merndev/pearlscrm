"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { EditRequestBadge } from "@/components/app/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTimestamp } from "@/lib/dates";
import { cancelEditRequest } from "@/server/actions/edit-requests";
import type { CaseEditRequestRow } from "@/lib/types";

function sectionName(request: CaseEditRequestRow): string {
  if (request.scope === "CASE_INFORMATION") return "Case information";
  if (request.scope === "CASE_NOTES") return "Case notes";
  if (request.scope === "VISIT_DETAILS") return `${request.visit_label ?? "Visit"} details`;
  return `${request.visit_label ?? "Visit"} images`;
}

/**
 * Edit approvals raised against this case.
 *
 * Row visibility is decided by RLS, not here: a requester sees their own,
 * an administrator sees them all.
 */
export function CaseEditRequestsCard({
  requests,
  currentUserId,
}: {
  requests: CaseEditRequestRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (requests.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit approvals</CardTitle>
        <CardDescription>
          Submitted sections reopen only with an administrator&rsquo;s approval, and each approval
          covers one save.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="divide-y">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">{sectionName(request)}</p>
                <p className="text-muted-foreground text-xs">
                  {request.requested_by_name ?? "Unknown user"} ·{" "}
                  <span className="tabular-nums">{formatTimestamp(request.requested_at)}</span>
                </p>
                <p className="text-sm whitespace-pre-line">{request.reason}</p>
                {request.decision_note ? (
                  <p className="text-muted-foreground text-xs">
                    Note from {request.decided_by_name ?? "the administrator"}:{" "}
                    {request.decision_note}
                  </p>
                ) : null}
                {request.status === "APPROVED" && request.expires_at ? (
                  <p className="text-muted-foreground text-xs tabular-nums">
                    Usable until {formatTimestamp(request.expires_at)}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <EditRequestBadge status={request.status} />

                {request.status === "PENDING" && request.requested_by === currentUserId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await cancelEditRequest({ requestId: request.id });

                        if (!result.ok) {
                          toast.error(result.error.message);
                          return;
                        }

                        toast.success("Request withdrawn");
                        router.refresh();
                      })
                    }
                  >
                    Withdraw
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
