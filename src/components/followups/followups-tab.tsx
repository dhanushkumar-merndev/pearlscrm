"use client";

import { useState } from "react";
import { CalendarPlus, CalendarRange, Lock, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { VisitImagesPanel } from "@/components/clinical-images/visit-images-panel";
import { RequestEditDialog } from "@/components/cases/request-edit-dialog";
import { FollowupDialog } from "@/components/followups/followup-dialog";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatClinicDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { getEditAccess } from "@/server/actions/edit-requests";
import { deleteFollowup } from "@/server/actions/visits";
import type { CaseVisit, ImageViewType, RoleCode } from "@/lib/types";

/**
 * Follow-up visits.
 *
 * Real timeline records with actual dates — never a fixed set of 1M/3M/6M/12M
 * slots. Each follow-up gets the same standard clinical view grid as Before.
 */
export function FollowupsTab({
  caseId,
  surgeryDate,
  followups,
  viewTypes,
  role,
  maxImageBytes,
  readOnly,
}: {
  caseId: string;
  surgeryDate: string;
  followups: CaseVisit[];
  viewTypes: ImageViewType[];
  role: RoleCode;
  maxImageBytes: number;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [dialogVisit, setDialogVisit] = useState<CaseVisit | "new" | null>(null);
  const [requestVisit, setRequestVisit] = useState<CaseVisit | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CaseVisit | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * A follow-up's details lock the moment it is added. Clicking Edit resolves
   * this user's standing with the server first: it either opens the editor, or
   * it opens the approval request that has to come before one.
   */
  const beginEdit = (visit: CaseVisit) => {
    setChecking(visit.id);

    startTransition(async () => {
      const result = await getEditAccess({
        caseId,
        scope: "VISIT_DETAILS",
        visitId: visit.id,
      });

      setChecking(null);

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      if (result.data.allowed) {
        setDialogVisit(visit);
        return;
      }

      if (result.data.pendingRequestId) {
        toast.info("Your request to edit this follow-up is awaiting an administrator's decision.");
        return;
      }

      setRequestVisit(visit);
    });
  };

  const mayCreate = !readOnly && can(role, "visit:create");
  const mayEdit = !readOnly && can(role, "visit:update");
  const mayDelete = !readOnly && can(role, "visit:delete");

  const sorted = [...followups].sort((a, b) =>
    (a.visit_date ?? "").localeCompare(b.visit_date ?? ""),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Follow-up visits</h2>
          <p className="text-muted-foreground text-sm">
            Labels are suggested from the actual visit date and can be corrected. The dates are
            authoritative.
          </p>
        </div>

        {mayCreate ? (
          <Button onClick={() => setDialogVisit("new")}>
            <CalendarPlus aria-hidden />
            Add Follow-up
          </Button>
        ) : null}
      </div>

      {sorted.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarRange />
            </EmptyMedia>
            <EmptyTitle>No follow-up visits have been added.</EmptyTitle>
            <EmptyDescription>
              Add a follow-up to record its date, observation and clinical images.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Tabs defaultValue={sorted[0].id} className="gap-4">
          <div className="overflow-x-auto overflow-y-hidden">
            <TabsList>
              {sorted.map((visit) => (
                <TabsTrigger key={visit.id} value={visit.id}>
                  {visit.display_label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {sorted.map((visit) => (
            <TabsContent key={visit.id} value={visit.id} className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2">
                        {visit.display_label}
                        {visit.months_after_surgery !== null ? (
                          <Badge variant="outline" className="tabular-nums">
                            {visit.months_after_surgery} months after surgery
                          </Badge>
                        ) : null}
                      </CardTitle>
                      <CardDescription className="tabular-nums">
                        Visit date {formatClinicDate(visit.visit_date)}
                      </CardDescription>
                    </div>

                    <div className="flex gap-2">
                      {mayEdit ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={checking === visit.id}
                          onClick={() => beginEdit(visit)}
                        >
                          {visit.details_locked_at ? (
                            <Lock aria-hidden />
                          ) : (
                            <Pencil aria-hidden />
                          )}
                          Edit
                        </Button>
                      ) : null}
                      {mayDelete ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleteTarget(visit)}
                        >
                          <Trash2 aria-hidden />
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>

                {visit.clinical_observation ? (
                  <CardContent>
                    <p className="text-muted-foreground mb-1 text-xs font-medium">
                      Follow-up observation
                    </p>
                    <p className="text-sm whitespace-pre-line">{visit.clinical_observation}</p>
                  </CardContent>
                ) : null}
              </Card>

              <VisitImagesPanel
                caseId={caseId}
                visit={visit}
                viewTypes={viewTypes}
                role={role}
                maxImageBytes={maxImageBytes}
                readOnly={readOnly}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}

      <FollowupDialog
        key={dialogVisit === "new" ? "new" : dialogVisit?.id ?? "closed"}
        open={dialogVisit !== null}
        onOpenChange={(open) => !open && setDialogVisit(null)}
        caseId={caseId}
        surgeryDate={surgeryDate}
        visit={dialogVisit === "new" ? null : dialogVisit}
      />

      {requestVisit ? (
        <RequestEditDialog
          open
          onOpenChange={(open) => !open && setRequestVisit(null)}
          caseId={caseId}
          scope="VISIT_DETAILS"
          visitId={requestVisit.id}
          sectionLabel={`${requestVisit.display_label} details`}
        />
      ) : null}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.display_label}?</AlertDialogTitle>
            <AlertDialogDescription>
              A follow-up can only be removed while it holds no clinical images. Uploaded originals
              are never deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() => {
                const visit = deleteTarget;
                setDeleteTarget(null);
                if (!visit) return;

                startTransition(async () => {
                  const result = await deleteFollowup({ visitId: visit.id });

                  if (!result.ok) {
                    toast.error(result.error.message);
                    return;
                  }

                  toast.success("Follow-up removed");
                  router.refresh();
                });
              }}
            >
              Remove follow-up
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
