"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Save, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { ReviewBadge } from "@/components/app/status-badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatTimestamp } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { updateReview } from "@/server/actions/review";
import type { CaseDetail } from "@/server/queries/cases";
import type { ReviewStatus, RoleCode } from "@/lib/types";

/**
 * Expert review: the surgeon's final assessment.
 *
 * Documented behaviour: editing an assessment after completion keeps the review
 * COMPLETED, snapshots the previous text into the revision history, and audits
 * the edit.
 */
export function CaseReviewTab({ detail, role }: { detail: CaseDetail; role: RoleCode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [assessment, setAssessment] = useState(detail.review?.final_assessment ?? "");
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = detail.review;
  const status: ReviewStatus = review?.status ?? "PENDING";
  const editable = can(role, "review:update") && !detail.summary.archived_at;
  const dirty = assessment !== (review?.final_assessment ?? "");

  const save = (nextStatus: ReviewStatus) => {
    if (!review) return;

    setError(null);
    setConflict(false);

    startTransition(async () => {
      const result = await updateReview({
        caseId: detail.summary.id,
        status: nextStatus,
        finalAssessment: assessment,
        expectedVersion: review.version,
      });

      if (!result.ok) {
        if (result.error.code === "CONFLICT") {
          setConflict(true);
          return;
        }
        setError(result.error.message);
        return;
      }

      toast.success(
        nextStatus === "COMPLETED" ? "Expert review completed" : "Expert review saved",
      );
      router.refresh();
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Dr. Praveen&rsquo;s final assessment</CardTitle>
          <CardDescription>
            The structured expert review for this case. Recorded against the reviewing surgeon with
            a timestamp.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <FieldGroup>
            {conflict ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>This review was changed by someone else</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-2">
                  Nothing was overwritten. Reload the case to see the current assessment.
                  <Button variant="outline" size="sm" onClick={() => router.refresh()}>
                    Reload
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not save the review</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {status === "COMPLETED" && editable ? (
              <Alert>
                <CheckCircle2 />
                <AlertTitle>This review is complete</AlertTitle>
                <AlertDescription>
                  Editing the assessment keeps the review completed, records the change in the audit
                  history, and retains the previous version.
                </AlertDescription>
              </Alert>
            ) : null}

            <Field>
              <FieldLabel htmlFor="final-assessment">Final assessment</FieldLabel>
              <Textarea
                id="final-assessment"
                rows={12}
                disabled={!editable}
                value={assessment}
                onChange={(event) => setAssessment(event.target.value)}
                placeholder="Overall clinical assessment of this case"
              />
              <FieldDescription>
                A final assessment is required before the review can be completed.
              </FieldDescription>
            </Field>

            {editable ? (
              <div className="flex flex-wrap gap-2">
                {status === "PENDING" ? (
                  <Button variant="outline" onClick={() => save("IN_REVIEW")} disabled={pending}>
                    {pending ? <Spinner /> : null}
                    Start review
                  </Button>
                ) : null}

                {status !== "COMPLETED" ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => save(status === "PENDING" ? "IN_REVIEW" : status)}
                      disabled={pending || !dirty}
                    >
                      {pending ? <Spinner /> : <Save aria-hidden />}
                      Save draft
                    </Button>
                    <Button
                      onClick={() => save("COMPLETED")}
                      disabled={pending || assessment.trim() === ""}
                    >
                      {pending ? <Spinner /> : <CheckCircle2 aria-hidden />}
                      Complete review
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => save("COMPLETED")} disabled={pending || !dirty}>
                    {pending ? <Spinner /> : <Save aria-hidden />}
                    Save assessment
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Only a surgeon or an administrator can record the expert review.
              </p>
            )}
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Review status</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <ReviewBadge status={status} />

          <dl className="space-y-3 text-sm">
            <div className="space-y-0.5">
              <dt className="text-muted-foreground text-xs">Reviewer</dt>
              <dd className="font-medium">{detail.reviewerName ?? "Not assigned"}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-muted-foreground text-xs">Reviewed at</dt>
              <dd className="font-medium tabular-nums">{formatTimestamp(review?.reviewed_at)}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-muted-foreground text-xs">Last updated</dt>
              <dd className="font-medium tabular-nums">{formatTimestamp(review?.updated_at)}</dd>
            </div>
          </dl>

          <p className="text-muted-foreground text-xs">
            Workflow: Pending → In review → Completed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
