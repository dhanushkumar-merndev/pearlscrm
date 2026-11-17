"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, CheckCircle2, Clock, ListChecks } from "lucide-react";
import { toast } from "sonner";

import { type DoctorChoice } from "@/components/app/doctor-select";
import { VisitImagesPanel } from "@/components/clinical-images/visit-images-panel";
import { AddSessionDialog } from "@/components/sessions/add-session-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatClinicDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { completeSession } from "@/server/actions/treatments";
import type { CaseDetail } from "@/server/queries/cases";
import type { ImageViewType, RoleCode } from "@/lib/types";

/**
 * Sessions of a session-based treatment (laser, injectables, …).
 *
 * Before and After photos are compulsory: the database refuses to complete a
 * session until every session view is uploaded. The disabled button and its
 * reason here are the explanation; `complete_treatment_session` is the rule.
 */
export function SessionsTab({
  detail,
  sessionViewTypes,
  doctors,
  role,
  currentUserId,
  maxImageBytes,
  readOnly,
}: {
  detail: CaseDetail;
  sessionViewTypes: ImageViewType[];
  doctors: DoctorChoice[];
  role: RoleCode;
  currentUserId: string;
  maxImageBytes: number;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const { summary } = detail;
  const sessions = detail.visits
    .filter((visit) => visit.visit_type === "SESSION")
    .sort((a, b) => (a.session_number ?? 0) - (b.session_number ?? 0));
  const planned = summary.planned_sessions ?? 0;
  const completed = sessions.filter((s) => s.session_status === "COMPLETED").length;
  const closed = summary.status === "COMPLETED" || Boolean(summary.archived_at);
  const doctorName = new Map(doctors.map((d) => [d.id, d.display_name]));
  const required = sessionViewTypes.length;

  const mayAdd = !readOnly && !closed && can(role, "session:record");
  const [selectedTab, setTab] = useState<string | null>(null);
  // Sessions arrive from the server after a refresh, so the selection is
  // derived: an explicit pick if it still exists, else the open (or latest)
  // session. Without this a first session added on an empty tab stayed hidden.
  const defaultTab = (sessions.find((s) => s.session_status !== "COMPLETED") ?? sessions.at(-1))?.id ?? "";
  const tab = selectedTab && sessions.some((s) => s.id === selectedTab) ? selectedTab : defaultTab;

  const complete = (visitId: string) => {
    setCompleting(visitId);
    startTransition(async () => {
      const result = await completeSession({ caseId: summary.id, visitId });
      setCompleting(null);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(`${result.data.display_label} completed.`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Treatment sessions</h2>
          <p className="text-muted-foreground text-sm">
            Every session needs its Before and After photos before it can be completed.
          </p>
        </div>
        {mayAdd ? (
          <Button onClick={() => setAdding(true)}>
            <CalendarPlus aria-hidden />
            Add session
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-semibold tabular-nums">
              {completed} of {planned} sessions
            </span>
          </div>
          <Progress
            value={planned ? Math.min(100, (completed / planned) * 100) : 0}
            aria-label={`${completed} of ${planned} sessions completed`}
          />
          {summary.next_session_date ? (
            <p className="text-muted-foreground text-xs">
              Next visit {formatClinicDate(summary.next_session_date)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {sessions.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecks aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No sessions recorded yet</EmptyTitle>
            <EmptyDescription>
              {planned} session{planned === 1 ? "" : "s"} planned from{" "}
              {formatClinicDate(summary.start_date)}. Add the first session when the patient comes in.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <div className="overflow-x-auto overflow-y-hidden">
            <TabsList>
              {sessions.map((s) => (
                <TabsTrigger key={s.id} value={s.id}>
                  {s.session_status === "COMPLETED" ? (
                    <CheckCircle2 className="text-emerald-600" aria-hidden />
                  ) : (
                    <Clock aria-hidden />
                  )}
                  {s.display_label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {sessions.map((s) => {
            const photos = detail.sessionPhotos[s.id] ?? { uploaded: 0, notAvailable: 0 };
            const done = s.session_status === "COMPLETED";
            // NOT_AVAILABLE counts only when an administrator set it; the
            // database makes that call and explains if it refuses.
            const missing = Math.max(0, required - photos.uploaded - photos.notAvailable);
            const mayComplete =
              !done && !readOnly && !closed && can(role, "session:record") && missing === 0;

            return (
              <TabsContent key={s.id} value={s.id} className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {s.display_label}
                      {done ? (
                        <Badge variant="secondary">
                          <CheckCircle2 aria-hidden />
                          Completed
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          <Clock aria-hidden />
                          Photos pending
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {formatClinicDate(s.visit_date)}
                      {s.doctor_id ? ` · ${doctorName.get(s.doctor_id) ?? "Doctor"}` : ""}
                      {s.next_visit_date ? ` · Next visit ${formatClinicDate(s.next_visit_date)}` : ""}
                    </CardDescription>
                  </CardHeader>
                  {s.clinical_observation ? (
                    <CardContent>
                      <p className="text-sm whitespace-pre-line">{s.clinical_observation}</p>
                    </CardContent>
                  ) : null}
                </Card>

                <VisitImagesPanel
                  caseId={summary.id}
                  visit={s}
                  viewTypes={sessionViewTypes}
                  role={role}
                  maxImageBytes={maxImageBytes}
                  readOnly={readOnly || closed}
                />

                {!done && can(role, "session:record") && !readOnly && !closed ? (
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                    {missing > 0 ? (
                      <Alert className="sm:max-w-xl">
                        <AlertTitle>Photos required</AlertTitle>
                        <AlertDescription>
                          {missing} of {required} photo{required === 1 ? "" : "s"} still to upload and
                          save. Before and After photos are compulsory for every session.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <p className="text-muted-foreground text-sm">Both photos are in.</p>
                    )}
                    <Button onClick={() => complete(s.id)} disabled={!mayComplete || completing === s.id}>
                      {completing === s.id ? <Spinner /> : <CheckCircle2 aria-hidden />}
                      Complete session
                    </Button>
                  </div>
                ) : null}
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      {mayAdd ? (
        <AddSessionDialog
          key={adding ? "open" : "closed"}
          open={adding}
          onOpenChange={setAdding}
          onAdded={setTab}
          caseId={summary.id}
          sessionNumber={sessions.length + 1}
          doctors={doctors}
          currentUserId={currentUserId}
        />
      ) : null}
    </div>
  );
}
