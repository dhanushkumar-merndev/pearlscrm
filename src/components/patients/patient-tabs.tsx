"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  CalendarPlus,
  Camera,
  FileText,
  MessageSquarePlus,
  NotebookPen,
  Plus,
  Scissors,
  Stethoscope,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { CaseStatusBadge } from "@/components/app/status-badges";
import {
  AddNoteDialog,
  AddTreatmentDialog,
  RecordVisitDialog,
  UploadPrescriptionDialog,
} from "@/components/patients/patient-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatClinicDate, formatTimestamp } from "@/lib/dates";
import { formatBytes } from "@/lib/images";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Branch, RoleCode } from "@/lib/types";
import type { PatientDetail } from "@/server/queries/patients";

type TimelineEvent = {
  key: string;
  date: string;
  icon: React.ReactNode;
  title: string;
  detail?: string | null;
  href?: string;
  upcoming?: boolean;
};

/** Everything that happened to this patient, newest first; future visits on top. */
function buildTimeline(detail: PatientDetail): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const caseNumber = new Map(detail.treatments.map((t) => [t.id, t]));

  for (const c of detail.consultations) {
    events.push({
      key: `c-${c.id}`,
      date: c.visit_date,
      icon: <Stethoscope className="size-3.5" aria-hidden />,
      title: `${c.is_first_visit ? "First consultation" : "Consultation"}${c.branch_code ? ` · ${c.branch_code}` : ""}`,
      detail: [c.doctor_name, c.notes].filter(Boolean).join(" — ") || null,
    });
  }

  for (const t of detail.treatments) {
    events.push({
      key: `t-${t.id}`,
      date: (t.start_date ?? t.created_at).slice(0, 10),
      icon: <Plus className="size-3.5" aria-hidden />,
      title: `${t.procedure_name} planned · ${t.case_number}`,
      detail:
        t.treatment_mode === "SESSIONS"
          ? `${t.planned_sessions ?? "?"} sessions`
          : t.procedure_type_name,
      href: `/cases/${t.id}`,
    });
    if (t.treatment_mode === "SURGICAL" && t.surgery_date) {
      events.push({
        key: `s-${t.id}`,
        date: t.surgery_date,
        icon: <Scissors className="size-3.5" aria-hidden />,
        title: `Surgery · ${t.procedure_name}`,
        detail: t.case_number,
        href: `/cases/${t.id}`,
      });
    }
  }

  for (const s of detail.sessions) {
    if (!s.visit_date) continue;
    const t = caseNumber.get(s.case_id);
    events.push({
      key: `v-${s.id}`,
      date: s.visit_date,
      icon: <Camera className="size-3.5" aria-hidden />,
      title: `${t?.procedure_name ?? "Treatment"} · ${s.display_label}`,
      detail: [s.session_status === "COMPLETED" ? "Completed" : "Photos pending", s.doctor_name].filter(Boolean).join(" · "),
      href: `/cases/${s.case_id}?tab=sessions`,
    });
  }

  for (const n of detail.notes) {
    events.push({
      key: `n-${n.id}`,
      date: n.created_at.slice(0, 10),
      icon: <NotebookPen className="size-3.5" aria-hidden />,
      title: `Note${n.author_name ? ` by ${n.author_name}` : ""}${n.case_number ? ` · ${n.case_number}` : ""}`,
      detail: n.body.length > 160 ? `${n.body.slice(0, 160)}…` : n.body,
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (detail.patient.next_visit_date && detail.patient.next_visit_date >= today) {
    events.push({
      key: "next",
      date: detail.patient.next_visit_date,
      icon: <CalendarCheck className="size-3.5" aria-hidden />,
      title: "Next visit due",
      upcoming: true,
    });
  }

  return events.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}

export function PatientTabs({
  detail,
  role,
  branches,
  myBranchId,
}: {
  detail: PatientDetail;
  role: RoleCode;
  branches: Branch[];
  myBranchId: string | null;
}) {
  const { patient } = detail;
  const archived = Boolean(patient.archived_at);
  const [dialog, setDialog] = useState<"treatment" | "note" | "visit" | "rx" | null>(null);
  const timeline = buildTimeline(detail);
  const close = (open: boolean) => !open && setDialog(null);

  const mayTreat = !archived && can(role, "treatment:create");
  const mayNote = !archived && can(role, "patient_note:create");
  const mayVisit = !archived && can(role, "consultation:record");
  const mayRx = !archived && can(role, "prescription:upload");

  const openDocument = async (documentId: string) => {
    // Opened synchronously so popup blockers allow it, then pointed at the
    // fresh short-lived URL once the server has authorised it.
    // (`noopener` would make window.open return null, so the opener is cut by hand.)
    const win = window.open("", "_blank");
    if (win) win.opener = null;
    try {
      const response = await fetch(`/api/documents/${documentId}/url`);
      if (!response.ok) throw new Error();
      const { url } = (await response.json()) as { url: string };
      if (win) win.location.href = url;
      else window.location.assign(url);
    } catch {
      win?.close();
      toast.error("The document could not be opened.");
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {mayTreat ? (
          <Button onClick={() => setDialog("treatment")}>
            <Plus aria-hidden />
            Add treatment
          </Button>
        ) : null}
        {mayVisit ? (
          <Button variant="outline" onClick={() => setDialog("visit")}>
            <CalendarPlus aria-hidden />
            Record visit
          </Button>
        ) : null}
        {mayNote ? (
          <Button variant="outline" onClick={() => setDialog("note")}>
            <MessageSquarePlus aria-hidden />
            Add note
          </Button>
        ) : null}
        {mayRx ? (
          <Button variant="outline" onClick={() => setDialog("rx")}>
            <Upload aria-hidden />
            Upload prescription
          </Button>
        ) : null}
      </div>

      <Tabs defaultValue="timeline" className="gap-4">
        <div className="overflow-x-auto overflow-y-hidden">
          <TabsList>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="treatments">
              Treatments <span className="text-muted-foreground tabular-nums">({detail.treatments.length})</span>
            </TabsTrigger>
            <TabsTrigger value="prescriptions">
              Prescriptions <span className="text-muted-foreground tabular-nums">({detail.documents.length})</span>
            </TabsTrigger>
            <TabsTrigger value="notes">
              Notes <span className="text-muted-foreground tabular-nums">({detail.notes.length})</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="timeline">
          {timeline.length === 0 ? (
            <EmptyBlock icon={<CalendarCheck aria-hidden />} title="Nothing recorded yet" description="Visits, treatments, sessions and notes appear here." />
          ) : (
            <Card>
              <CardContent className="pt-6">
                <ol className="border-border/80 relative ml-3.5 space-y-6 border-l pb-1 pl-6">
                  {timeline.map((event) => (
                    <li key={event.key} className="relative">
                      <span
                        className={cn(
                          "bg-background border-border text-muted-foreground absolute top-0 -left-6 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border",
                          event.upcoming && "border-primary text-primary",
                        )}
                        aria-hidden
                      >
                        {event.icon}
                      </span>
                      <div className="space-y-0.5 pt-0.5">
                        <p className="text-sm leading-none font-medium">
                          {event.href ? (
                            <Link href={event.href} className="hover:underline">
                              {event.title}
                            </Link>
                          ) : (
                            event.title
                          )}
                        </p>
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {formatClinicDate(event.date)}
                          {event.upcoming ? " · upcoming" : ""}
                        </p>
                        {event.detail ? (
                          <p className="text-muted-foreground text-sm whitespace-pre-line">{event.detail}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="treatments">
          {detail.treatments.length === 0 ? (
            <EmptyBlock icon={<Plus aria-hidden />} title="No treatments yet" description="Add a treatment to start tracking sessions or a surgery." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {detail.treatments.map((t) => {
                const sessions = t.treatment_mode === "SESSIONS";
                const planned = t.planned_sessions ?? 0;
                return (
                  <Card key={t.id}>
                    <CardHeader>
                      <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                        <span>{t.procedure_name}</span>
                        <CaseStatusBadge status={t.archived_at ? "ARCHIVED" : t.status} />
                      </CardTitle>
                      <CardDescription className="tabular-nums">
                        {t.case_number}
                        {t.branch_code ? ` · ${t.branch_code}` : ""}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {sessions ? (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Sessions</span>
                            <span className="font-medium tabular-nums">
                              {t.completed_sessions} of {planned}
                            </span>
                          </div>
                          <Progress value={planned ? Math.min(100, (t.completed_sessions / planned) * 100) : 0} aria-label="Sessions completed" />
                          <p className="text-muted-foreground text-xs">
                            Started {formatClinicDate(t.start_date)}
                            {t.next_session_date ? ` · Next ${formatClinicDate(t.next_session_date)}` : ""}
                          </p>
                        </>
                      ) : (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Surgery</span>
                          <span className="font-medium tabular-nums">
                            {t.surgery_date ? formatClinicDate(t.surgery_date) : "Not scheduled"}
                          </span>
                        </div>
                      )}
                    </CardContent>
                    <CardFooter className="gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/cases/${t.id}${sessions ? "?tab=sessions" : ""}`}>Open</Link>
                      </Button>
                      {!sessions && !t.surgery_date && t.status === "PLANNED" && can(role, "surgery:schedule") ? (
                        <Button asChild size="sm">
                          <Link href={`/cases/${t.id}`}>
                            <Scissors aria-hidden />
                            Mark for surgery
                          </Link>
                        </Button>
                      ) : null}
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="prescriptions">
          {detail.documents.length === 0 ? (
            <EmptyBlock icon={<FileText aria-hidden />} title="No prescriptions uploaded" description="Upload the prescription from a visit to keep it with the patient." />
          ) : (
            <Card>
              <CardContent className="divide-y p-0">
                {detail.documents.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0 space-y-0.5">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <FileText className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">{d.original_filename ?? "Prescription"}</span>
                        <Badge variant="outline">{d.mime_type === "application/pdf" ? "PDF" : "Image"}</Badge>
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {formatTimestamp(d.uploaded_at)}
                        {d.uploader_name ? ` · ${d.uploader_name}` : ""} · {formatBytes(d.file_size)}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openDocument(d.id)}>
                      Open
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="notes">
          {detail.notes.length === 0 ? (
            <EmptyBlock icon={<NotebookPen aria-hidden />} title="No notes yet" description="Doctors' comments and next-visit dates appear here." />
          ) : (
            <div className="space-y-3">
              {detail.notes.map((n) => (
                <Card key={n.id}>
                  <CardHeader className="pb-0">
                    <CardDescription className="flex flex-wrap gap-x-2">
                      <span className="text-foreground font-medium">{n.author_name ?? "Unknown author"}</span>
                      <span>{formatTimestamp(n.created_at)}</span>
                      {n.case_number ? <Badge variant="outline">{n.case_number}</Badge> : null}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm whitespace-pre-line">{n.body}</p>
                    {n.next_visit_date ? (
                      <p className="text-muted-foreground text-xs">Next visit {formatClinicDate(n.next_visit_date)}</p>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {dialog === "treatment" ? (
        <AddTreatmentDialog
          open
          onOpenChange={close}
          patientId={patient.id}
          branchId={myBranchId ?? patient.branch_id}
          consultations={detail.consultations}
          role={role}
        />
      ) : null}
      {dialog === "note" ? (
        <AddNoteDialog open onOpenChange={close} patientId={patient.id} treatments={detail.treatments} />
      ) : null}
      {dialog === "visit" ? (
        <RecordVisitDialog
          open
          onOpenChange={close}
          patientId={patient.id}
          branches={branches}
          defaultBranchId={myBranchId ?? patient.branch_id}
        />
      ) : null}
      {dialog === "rx" ? (
        <UploadPrescriptionDialog open onOpenChange={close} patientId={patient.id} consultations={detail.consultations} />
      ) : null}
    </>
  );
}

function EmptyBlock({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
