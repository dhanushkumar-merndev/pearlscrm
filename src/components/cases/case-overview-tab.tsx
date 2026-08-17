"use client";

import { Check, Circle, CircleDashed, Scissors } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { buildChecklist, completionPercent, isComplete } from "@/lib/completion";
import { formatClinicDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { CaseDetail } from "@/server/queries/cases";

/**
 * Overview: case facts, the completion checklist, and the clinical timeline.
 */
export function CaseOverviewTab({
  detail,
  onNavigate,
}: {
  detail: CaseDetail;
  onNavigate: (tab: string) => void;
}) {
  const { summary, completion } = detail;
  const checklist = buildChecklist(completion);
  const percent = completionPercent(completion);
  const complete = isComplete(completion);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Case information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Case ID" value={summary.case_number} mono />
              <Detail label="Procedure" value={summary.procedure_name} />
              <Detail label="Procedure type" value={summary.procedure_type_name} />
              <Detail label="Date of surgery" value={formatClinicDate(summary.surgery_date)} mono />
              <Detail
                label="Follow-up availability"
                value={summary.followup_availability ?? "Not specified"}
              />
              <Detail
                label="Follow-up visits recorded"
                value={String(summary.followup_count)}
                mono
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Clinical timeline</CardTitle>
            <CardDescription>
              Built from the actual recorded visit dates, not from fixed follow-up slots.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Timeline detail={detail} />
          </CardContent>
        </Card>
      </div>

      <Card className="lg:sticky lg:top-20 lg:self-start">
        <CardHeader>
          <CardTitle>Case completion</CardTitle>
          <CardDescription>
            {complete
              ? "All required items are complete."
              : "Some required items are still outstanding."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-semibold tabular-nums">{percent}%</span>
              {complete ? <Badge variant="secondary">Ready to complete</Badge> : null}
            </div>
            <Progress value={percent} aria-label={`Case completion ${percent} percent`} />
          </div>

          <Separator />

          <ul className="space-y-3">
            {checklist.map((item) => (
              <li key={item.key} className="flex gap-2.5">
                {item.done ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                ) : item.required ? (
                  <Circle className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                ) : (
                  <CircleDashed className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                )}

                <div className="min-w-0 space-y-0.5">
                  <p className={cn("text-sm", item.done ? "" : "font-medium")}>
                    {item.label}
                    {!item.required ? (
                      <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                        (informational)
                      </span>
                    ) : null}
                  </p>
                  {item.detail ? (
                    <p className="text-muted-foreground text-xs">{item.detail}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <Separator />

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => onNavigate("before")}>
              Before images
            </Button>
            <Button variant="outline" size="sm" onClick={() => onNavigate("notes")}>
              Case notes
            </Button>
            <Button variant="outline" size="sm" onClick={() => onNavigate("review")}>
              Expert review
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn("text-sm font-medium", mono && "tabular-nums")}>{value}</dd>
    </div>
  );
}

function Timeline({ detail }: { detail: CaseDetail }) {
  const followups = detail.visits
    .filter((visit) => visit.visit_type === "FOLLOW_UP")
    .sort((a, b) => (a.visit_date ?? "").localeCompare(b.visit_date ?? ""));

  const standardViews = detail.summary.standard_view_count;
  const beforeResolved =
    (detail.summary.before_uploaded_count ?? 0) + (detail.summary.before_not_available_count ?? 0);

  return (
    <ol className="relative space-y-6 border-l pl-6">
      <TimelineEntry
        icon={<Scissors className="size-3" aria-hidden />}
        title="Surgery"
        meta={formatClinicDate(detail.summary.surgery_date)}
      />

      <TimelineEntry
        title="Before"
        meta={
          beforeResolved >= standardViews
            ? "Images complete"
            : `${beforeResolved} of ${standardViews} views resolved`
        }
        complete={beforeResolved >= standardViews}
      />

      {followups.length === 0 ? (
        <TimelineEntry title="Follow-ups" meta="No follow-up visits have been added." />
      ) : (
        followups.map((visit) => (
          <TimelineEntry
            key={visit.id}
            title={visit.display_label}
            meta={formatClinicDate(visit.visit_date)}
            detail={
              visit.months_after_surgery !== null
                ? `${visit.months_after_surgery} months after surgery`
                : undefined
            }
          />
        ))
      )}
    </ol>
  );
}

function TimelineEntry({
  icon,
  title,
  meta,
  detail,
  complete,
}: {
  icon?: React.ReactNode;
  title: string;
  meta: string;
  detail?: string;
  complete?: boolean;
}) {
  return (
    <li className="relative">
      <span
        className={cn(
          "bg-background absolute -left-[31px] flex size-5 items-center justify-center rounded-full border",
          complete && "border-emerald-600/50 text-emerald-600 dark:text-emerald-400",
        )}
        aria-hidden
      >
        {icon ?? (complete ? <Check className="size-3" /> : null)}
      </span>

      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground text-xs tabular-nums">{meta}</p>
      {detail ? <p className="text-muted-foreground text-xs">{detail}</p> : null}
    </li>
  );
}
