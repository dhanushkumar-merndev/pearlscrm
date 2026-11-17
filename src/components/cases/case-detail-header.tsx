"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  BellRing,
  CalendarClock,
  CalendarX,
  CheckCircle2,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { CaseStatusBadge, ConsentBadge, ReviewBadge } from "@/components/app/status-badges";
import { type DoctorChoice } from "@/components/app/doctor-select";
import { EditCaseDialog } from "@/components/cases/edit-case-dialog";
import { LinkPatientDialog } from "@/components/patients/link-patient-dialog";
import { MarkSurgeryDialog } from "@/components/cases/mark-surgery-dialog";
import { ManageCaseAccessDialog } from "@/components/cases/manage-case-access-dialog";
import { RequestEditDialog } from "@/components/cases/request-edit-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { formatClinicDate } from "@/lib/dates";
import { completionPercent, isComplete } from "@/lib/completion";
import { can } from "@/lib/permissions";
import { archiveCase, markCaseCompleted, reopenCase, restoreCase } from "@/server/actions/cases";
import { cancelSurgery } from "@/server/actions/treatments";
import { formatClinicDateTime } from "@/lib/reminders";
import { todayIsoDate } from "@/lib/dates";
import { getEditAccess } from "@/server/actions/edit-requests";
import type { CaseDetail } from "@/server/queries/cases";
import type { CaseAccessUser } from "@/server/queries/case-access";
import type { RoleCode, SurgeryReminder } from "@/lib/types";

/**
 * Case header.
 *
 * Operational status, data completion and expert review are shown as three
 * separate signals rather than collapsed into one overloaded label.
 */
export function CaseDetailHeader({
  detail,
  role,
  accessUsers,
  doctors,
  reminders,
}: {
  detail: CaseDetail;
  role: RoleCode;
  accessUsers: CaseAccessUser[] | null;
  doctors: DoctorChoice[];
  reminders: SurgeryReminder[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"archive" | "restore" | null>(null);
  const [editing, setEditing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [managingAccess, setManagingAccess] = useState(false);
  const [schedulingSurgery, setSchedulingSurgery] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirmCancelSurgery, setConfirmCancelSurgery] = useState(false);

  const { summary, completion, consentState, review } = detail;
  const percent = completionPercent(completion);
  const complete = isComplete(completion);
  const archived = Boolean(summary.archived_at);
  const surgical = summary.treatment_mode === "SURGICAL";
  const surgeonName = summary.surgeon_id
    ? (doctors.find((d) => d.id === summary.surgeon_id)?.display_name ?? null)
    : null;
  // Once surgery has happened its date anchors every follow-up interval.
  const surgeryChangeable =
    surgical &&
    !archived &&
    summary.status !== "COMPLETED" &&
    (summary.surgery_date === null || summary.surgery_date >= todayIsoDate());
  const mayScheduleSurgery = surgeryChangeable && can(role, "surgery:schedule");

  /**
   * Case information locks when the case is created. Clicking Edit asks the
   * server where this user stands before opening anything: either the editor,
   * or the approval request that has to precede it.
   */
  const beginEdit = () => {
    startTransition(async () => {
      const result = await getEditAccess({ caseId: summary.id, scope: "CASE_INFORMATION" });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      if (result.data.allowed) {
        setEditing(true);
        return;
      }

      if (result.data.pendingRequestId) {
        toast.info("Your request to edit this case is awaiting an administrator's decision.");
        return;
      }

      setRequesting(true);
    });
  };

  const run = (label: string, action: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    startTransition(async () => {
      const result = await action();

      if (!result.ok) {
        toast.error(result.error?.message ?? "Something went wrong.");
        return;
      }

      toast.success(label);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          {summary.patient_id && summary.file_id ? (
            <>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/patients">Patients</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={`/patients/${summary.patient_id}`} className="tabular-nums">
                    {summary.file_id}
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            </>
          ) : (
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/cases">Cases</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
          )}
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{summary.case_number}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{summary.case_number}</h1>
            <CaseStatusBadge status={archived ? "ARCHIVED" : summary.status} />
            <ConsentBadge state={consentState} />
            <ReviewBadge status={review?.status ?? "PENDING"} />
          </div>

          <dl className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt>Procedure:</dt>
              <dd className="text-foreground font-medium">{summary.procedure_name}</dd>
            </div>
            {surgical ? (
              <>
                <div className="flex gap-1.5">
                  <dt>Type:</dt>
                  <dd className="text-foreground font-medium">{summary.procedure_type_name ?? "—"}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt>Surgery:</dt>
                  <dd className="text-foreground font-medium tabular-nums">
                    {summary.surgery_date ? formatClinicDate(summary.surgery_date) : "Not scheduled"}
                  </dd>
                </div>
                {surgeonName ? (
                  <div className="flex gap-1.5">
                    <dt>Surgeon:</dt>
                    <dd className="text-foreground font-medium">{surgeonName}</dd>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="flex gap-1.5">
                  <dt>Sessions:</dt>
                  <dd className="text-foreground font-medium tabular-nums">
                    {summary.completed_sessions} of {summary.planned_sessions ?? "—"}
                  </dd>
                </div>
                <div className="flex gap-1.5">
                  <dt>Started:</dt>
                  <dd className="text-foreground font-medium tabular-nums">
                    {formatClinicDate(summary.start_date)}
                  </dd>
                </div>
              </>
            )}
          </dl>

          {reminders.length > 0 ? (
            <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
              <BellRing className="size-3.5" aria-hidden />
              Reminders:{" "}
              {reminders
                .map((r) => `${r.kind === "DAY_BEFORE" ? "evening before" : "morning of"} (${formatClinicDateTime(new Date(r.remind_at))})`)
                .join(" · ")}
            </p>
          ) : null}

          {detail.tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {detail.tags.map((tag) => (
                <Badge key={tag.id} variant="secondary">
                  {tag.display_name}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex items-start gap-4">
          {mayScheduleSurgery ? (
            <Button variant={summary.surgery_date ? "outline" : "default"} onClick={() => setSchedulingSurgery(true)}>
              <CalendarClock aria-hidden />
              {summary.surgery_date ? "Reschedule surgery" : "Mark for surgery"}
            </Button>
          ) : null}

          <div className="w-44 space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground text-xs">Case completion</span>
              <span className="text-sm font-semibold tabular-nums">{percent}%</span>
            </div>
            <Progress value={percent} aria-label={`Case completion ${percent} percent`} />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Case actions">
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-60">
              {can(role, "case_access:manage") ? (
                <DropdownMenuItem onSelect={() => setManagingAccess(true)}>
                  <Users aria-hidden />
                  Manage case access
                </DropdownMenuItem>
              ) : null}

              {mayScheduleSurgery && summary.surgery_date ? (
                <DropdownMenuItem disabled={pending} onSelect={() => setConfirmCancelSurgery(true)}>
                  <CalendarX aria-hidden />
                  Cancel scheduled surgery
                </DropdownMenuItem>
              ) : null}

              {can(role, "patient:link_case") && !summary.patient_id ? (
                <DropdownMenuItem onSelect={() => setLinking(true)}>
                  <Link2 aria-hidden />
                  Link to patient
                </DropdownMenuItem>
              ) : null}

              {can(role, "case:update") && !archived && surgical && summary.surgery_date ? (
                <DropdownMenuItem disabled={pending} onSelect={beginEdit}>
                  {summary.information_locked_at ? <Lock aria-hidden /> : <Pencil aria-hidden />}
                  Edit case information
                </DropdownMenuItem>
              ) : null}

              {can(role, "case:update") && !archived ? (
                summary.status === "COMPLETED" ? (
                  <DropdownMenuItem
                    disabled={pending}
                    onSelect={() => run("Case reopened", () => reopenCase({ caseId: summary.id }))}
                  >
                    <RotateCcw aria-hidden />
                    Reopen case
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    disabled={pending || !complete}
                    onSelect={() =>
                      run("Case marked completed", () => markCaseCompleted({ caseId: summary.id }))
                    }
                  >
                    <CheckCircle2 aria-hidden />
                    {complete ? "Mark as completed" : "Mark completed (checklist incomplete)"}
                  </DropdownMenuItem>
                )
              ) : null}

              {can(role, "case:archive") || can(role, "case:restore") ? (
                <>
                  <DropdownMenuSeparator />
                  {archived ? (
                    <DropdownMenuItem disabled={pending} onSelect={() => setConfirm("restore")}>
                      <ArchiveRestore aria-hidden />
                      Restore case
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      disabled={pending}
                      variant="destructive"
                      onSelect={() => setConfirm("archive")}
                    >
                      <Archive aria-hidden />
                      Archive case
                    </DropdownMenuItem>
                  )}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <EditCaseDialog
        open={editing}
        onOpenChange={setEditing}
        summary={summary}
        tags={detail.tags}
        role={role}
      />

      {mayScheduleSurgery ? (
        <MarkSurgeryDialog
          key={schedulingSurgery ? "open" : "closed"}
          open={schedulingSurgery}
          onOpenChange={setSchedulingSurgery}
          caseId={summary.id}
          caseNumber={summary.case_number}
          currentDate={summary.surgery_date}
          currentSurgeonId={summary.surgeon_id}
          doctors={doctors}
        />
      ) : null}

      {linking ? (
        <LinkPatientDialog
          open={linking}
          onOpenChange={setLinking}
          caseId={summary.id}
          caseNumber={summary.case_number}
        />
      ) : null}

      <AlertDialog open={confirmCancelSurgery} onOpenChange={setConfirmCancelSurgery}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel the surgery on {formatClinicDate(summary.surgery_date)}?</AlertDialogTitle>
            <AlertDialogDescription>
              The treatment goes back to Planned and its pending reminders are cancelled. Mark it
              for surgery again when a new date is agreed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep surgery</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => run("Surgery cancelled", () => cancelSurgery({ caseId: summary.id }))}
            >
              Cancel surgery
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RequestEditDialog
        open={requesting}
        onOpenChange={setRequesting}
        caseId={summary.id}
        scope="CASE_INFORMATION"
        sectionLabel="case information"
      />

      {accessUsers && managingAccess ? (
        <ManageCaseAccessDialog
          open={managingAccess}
          onOpenChange={setManagingAccess}
          caseId={summary.id}
          caseNumber={summary.case_number}
          users={accessUsers}
        />
      ) : null}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "archive" ? `Archive ${summary.case_number}?` : `Restore ${summary.case_number}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "archive"
                ? "Archived cases are hidden from the default case list. Nothing is deleted — clinical images and notes are retained and an administrator can restore the case at any time."
                : "The case will return to the active list and become editable again."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = confirm;
                setConfirm(null);

                if (action === "archive") {
                  run("Case archived", () => archiveCase({ caseId: summary.id }));
                } else if (action === "restore") {
                  run("Case restored", () => restoreCase({ caseId: summary.id }));
                }
              }}
            >
              {confirm === "archive" ? "Archive case" : "Restore case"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
