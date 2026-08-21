"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { describeScope } from "@/components/approvals/approvals-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatTimestamp } from "@/lib/dates";
import { decideEditRequest, getGrantableScopes } from "@/server/actions/edit-requests";
import type { CaseEditRequestRow, GrantableScope } from "@/lib/types";

/** How long an approval stays usable, if the requester does not save sooner. */
const TTL_OPTIONS = [
  { value: "24", label: "24 hours" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
];

/**
 * Approve or decline one request.
 *
 * An approval is deliberately time limited as well as single use: an editing
 * window left open indefinitely is the same as no lock at all.
 */
export function DecideRequestDialog({
  request,
  onOpenChange,
}: {
  request: CaseEditRequestRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [ttl, setTtl] = useState("168");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [scopes, setScopes] = useState<GrantableScope[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // The key of the section that was actually asked for. It is always granted by
  // the approval itself, so it is shown ticked and cannot be unticked.
  const requestedKey = request ? `${request.scope}:${request.visit_id ?? ""}` : null;

  useEffect(() => {
    if (!request) return;

    let cancelled = false;

    // Loads the case's sections for the request under review. Every state
    // update happens in the async completion, never synchronously here.
    void getGrantableScopes({
      caseId: request.case_id,
      userId: request.requested_by,
    }).then((result) => {
      if (cancelled) return;
      setScopes(result.ok ? result.data : []);
      setSelected(new Set(requestedKey ? [requestedKey] : []));
    });

    return () => {
      cancelled = true;
    };
  }, [request, requestedKey]);

  const toggle = (key: string) => {
    if (key === requestedKey) return;

    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const decide = (approve: boolean) => {
    if (!request) return;
    setError(null);

    startTransition(async () => {
      const extras = (scopes ?? [])
        .filter((scope) => selected.has(scope.key) && scope.key !== requestedKey)
        .map((scope) => ({ scope: scope.scope, visitId: scope.visitId }));

      const result = await decideEditRequest({
        requestId: request.id,
        approve,
        ...(note.trim() ? { note: note.trim() } : {}),
        ttlHours: Number(ttl),
        additionalScopes: approve ? extras : [],
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      const opened = approve ? selected.size : 0;

      toast.success(
        approve
          ? `${opened} section${opened === 1 ? "" : "s"} opened on ${request.case_number}. The requester has been notified.`
          : `Request declined on ${request.case_number}. The requester has been notified.`,
      );

      setNote("");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setNote("");
          setError(null);
          setScopes(null);
          setSelected(new Set());
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review edit request</DialogTitle>
          <DialogDescription>
            {request
              ? `${request.requested_by_name ?? "A user"} asked to edit the ${describeScope(
                  request,
                ).toLowerCase()} on ${request.case_number}, ${formatTimestamp(
                  request.requested_at,
                )}.`
              : null}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        {request ? (
          <div className="bg-muted/40 space-y-1 rounded-md border p-3">
            <p className="text-muted-foreground text-xs font-medium">Reason given</p>
            <p className="text-sm whitespace-pre-line">{request.reason}</p>
          </div>
        ) : null}

        <Field>
          <FieldLabel htmlFor="decision-scopes">Sections to open</FieldLabel>
          {scopes === null ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : (
            <ScrollArea className="max-h-52 rounded-md border" id="decision-scopes">
              <ul className="divide-y">
                {scopes.map((scope) => {
                  const isRequested = scope.key === requestedKey;
                  const held = scope.alreadyOpen && !isRequested;

                  return (
                    <li key={scope.key} className="flex items-center gap-2.5 px-3 py-2">
                      <Checkbox
                        id={`scope-${scope.key}`}
                        checked={selected.has(scope.key) || held}
                        disabled={isRequested || held}
                        onCheckedChange={() => toggle(scope.key)}
                      />
                      <Label
                        htmlFor={`scope-${scope.key}`}
                        className="flex-1 justify-start font-normal"
                      >
                        {scope.label}
                        {isRequested ? (
                          <span className="text-muted-foreground text-xs">requested</span>
                        ) : held ? (
                          <span className="text-muted-foreground text-xs">already open</span>
                        ) : !scope.locked ? (
                          <span className="text-muted-foreground text-xs">not yet submitted</span>
                        ) : null}
                      </Label>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
          <FieldDescription>
            The requested section is always included. Tick any neighbouring section to open it in
            the same decision — each gets its own single-use approval.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="decision-ttl">Approval valid for</FieldLabel>
          <Select value={ttl} onValueChange={setTtl}>
            <SelectTrigger id="decision-ttl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TTL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            The approval is single use — it closes as soon as the requester saves, or when this
            window elapses.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="decision-note">Note to the requester</FieldLabel>
          <Textarea
            id="decision-note"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional. Sent with the notification and recorded on the request."
          />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => decide(false)}>
            {pending ? <Spinner /> : <X aria-hidden />}
            Decline
          </Button>
          <Button disabled={pending} onClick={() => decide(true)}>
            {pending ? <Spinner /> : <Check aria-hidden />}
            Approve edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
