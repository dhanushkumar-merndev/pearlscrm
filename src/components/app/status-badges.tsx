import { AlertCircle, Check, CircleDashed, CircleSlash, Clock, ShieldCheck, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  CaseStatus,
  ConsentState,
  EditRequestStatus,
  ImageAvailability,
  ReviewStatus,
} from "@/lib/types";

/**
 * Status is never communicated by colour alone: every badge carries an icon and
 * a text label so it remains readable without colour perception.
 */

export function ConsentBadge({ state }: { state: ConsentState }) {
  if (state === "YES") {
    return (
      <Badge variant="outline" className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400">
        <Check aria-hidden />
        Consent confirmed — Yes
      </Badge>
    );
  }

  if (state === "NO") {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        <X aria-hidden />
        Consent confirmed — No
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-muted-foreground">
      <CircleDashed aria-hidden />
      Consent not recorded
    </Badge>
  );
}

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  if (status === "COMPLETED") {
    return (
      <Badge variant="outline" className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400">
        <Check aria-hidden />
        Review completed
      </Badge>
    );
  }

  if (status === "IN_REVIEW") {
    return (
      <Badge variant="outline" className="border-amber-600/40 text-amber-700 dark:text-amber-400">
        <Clock aria-hidden />
        In review
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-muted-foreground">
      <CircleDashed aria-hidden />
      Review pending
    </Badge>
  );
}

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  if (status === "COMPLETED") {
    return (
      <Badge variant="secondary">
        <Check aria-hidden />
        Completed
      </Badge>
    );
  }

  if (status === "ARCHIVED") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <CircleSlash aria-hidden />
        Archived
      </Badge>
    );
  }

  return (
    <Badge variant="outline">
      <Clock aria-hidden />
      Active
    </Badge>
  );
}

export function ImageAvailabilityBadge({ status }: { status: ImageAvailability }) {
  if (status === "UPLOADED") {
    return (
      <Badge variant="outline" className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400">
        <Check aria-hidden />
        Uploaded
      </Badge>
    );
  }

  if (status === "NOT_AVAILABLE") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <CircleSlash aria-hidden />
        Not available
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-muted-foreground">
      <AlertCircle aria-hidden />
      No image
    </Badge>
  );
}

/** Compact "n of 6" indicator used in the cases table. */
export function ImageCompletionBadge({
  resolved,
  total,
}: {
  resolved: number;
  total: number;
}) {
  const complete = total > 0 && resolved >= total;

  return (
    <Badge
      variant="outline"
      className={complete ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}
    >
      {complete ? <Check aria-hidden /> : <CircleDashed aria-hidden />}
      {resolved} of {total} views
    </Badge>
  );
}

/** Where one edit-approval request stands. */
export function EditRequestBadge({ status }: { status: EditRequestStatus }) {
  if (status === "PENDING") {
    return (
      <Badge variant="outline" className="border-amber-600/40 text-amber-700 dark:text-amber-400">
        <Clock aria-hidden />
        Awaiting decision
      </Badge>
    );
  }

  if (status === "APPROVED") {
    return (
      <Badge variant="outline" className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400">
        <ShieldCheck aria-hidden />
        Approved
      </Badge>
    );
  }

  if (status === "REJECTED") {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        <X aria-hidden />
        Declined
      </Badge>
    );
  }

  if (status === "CONSUMED") {
    return (
      <Badge variant="secondary">
        <Check aria-hidden />
        Used
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-muted-foreground">
      <CircleSlash aria-hidden />
      {status === "CANCELLED" ? "Withdrawn" : "Expired"}
    </Badge>
  );
}
