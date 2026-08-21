"use client";

import { useState } from "react";

import { CaseOverviewTab } from "@/components/cases/case-overview-tab";
import { CaseConsentTab } from "@/components/cases/case-consent-tab";
import { CaseNotesTab } from "@/components/case-notes/case-notes-tab";
import { CaseReviewTab } from "@/components/cases/case-review-tab";
import { CaseAuditTab } from "@/components/cases/case-audit-tab";
import { VisitImagesPanel } from "@/components/clinical-images/visit-images-panel";
import { FollowupsTab } from "@/components/followups/followups-tab";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can } from "@/lib/permissions";
import type { CaseDetail } from "@/server/queries/cases";
import type { EditAccess, ImageViewType, RoleCode } from "@/lib/types";

/**
 * Case navigation stays inside tabs rather than expanding the sidebar.
 */
export function CaseTabs({
  detail,
  viewTypes,
  role,
  currentUserId,
  notesEditAccess,
  maxImageBytes,
}: {
  detail: CaseDetail;
  viewTypes: ImageViewType[];
  role: RoleCode;
  currentUserId: string;
  notesEditAccess: EditAccess;
  maxImageBytes: number;
}) {
  const [tab, setTab] = useState("overview");

  const beforeVisit = detail.visits.find((visit) => visit.visit_type === "BEFORE") ?? null;
  const afterVisit = detail.visits.find((visit) => visit.visit_type === "AFTER") ?? null;
  const followups = detail.visits.filter((visit) => visit.visit_type === "FOLLOW_UP");
  const showAudit = can(role, "audit:read");
  // The expert review is Dr. Praveen's, and Dr. Praveen is the administrator.
  // Other roles do not see the tab at all — the case header and completion
  // checklist still show whether the review has been signed off.
  const showReview = can(role, "review:read");
  const archived = Boolean(detail.summary.archived_at);

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-6">
      <div className="overflow-x-auto">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="before">Before</TabsTrigger>
          <TabsTrigger value="after">After</TabsTrigger>
          <TabsTrigger value="followups">
            Follow-ups
            {followups.length > 0 ? (
              <span className="text-muted-foreground ml-1 tabular-nums">({followups.length})</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="notes">Case Notes</TabsTrigger>
          <TabsTrigger value="consent">Consent</TabsTrigger>
          {showReview ? <TabsTrigger value="review">Expert Review</TabsTrigger> : null}
          {showAudit ? <TabsTrigger value="audit">Audit History</TabsTrigger> : null}
        </TabsList>
      </div>

      <TabsContent value="overview">
        <CaseOverviewTab
          detail={detail}
          currentUserId={currentUserId}
          showCreator={role === "ADMIN"}
          showReview={showReview}
          onNavigate={setTab}
        />
      </TabsContent>

      <TabsContent value="before">
        {beforeVisit ? (
          <VisitImagesPanel
            caseId={detail.summary.id}
            visit={beforeVisit}
            viewTypes={viewTypes}
            role={role}
            maxImageBytes={maxImageBytes}
            readOnly={archived}
          />
        ) : (
          <MissingPhase phase="Before" />
        )}
      </TabsContent>

      <TabsContent value="after">
        {afterVisit ? (
          <VisitImagesPanel
            caseId={detail.summary.id}
            visit={afterVisit}
            viewTypes={viewTypes}
            role={role}
            maxImageBytes={maxImageBytes}
            readOnly={archived}
          />
        ) : (
          <MissingPhase phase="After" />
        )}
      </TabsContent>

      <TabsContent value="followups">
        <FollowupsTab
          caseId={detail.summary.id}
          surgeryDate={detail.summary.surgery_date}
          followups={followups}
          viewTypes={viewTypes}
          role={role}
          maxImageBytes={maxImageBytes}
          readOnly={archived}
        />
      </TabsContent>

      <TabsContent value="notes">
        <CaseNotesTab detail={detail} role={role} editAccess={notesEditAccess} />
      </TabsContent>

      <TabsContent value="consent">
        <CaseConsentTab detail={detail} role={role} />
      </TabsContent>

      {showReview ? (
        <TabsContent value="review">
          <CaseReviewTab detail={detail} role={role} />
        </TabsContent>
      ) : null}

      {showAudit ? (
        <TabsContent value="audit">
          <CaseAuditTab caseId={detail.summary.id} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

/**
 * Before and After are created with every case. A case predating that change
 * shows this rather than an empty panel, so the gap is visible instead of silent.
 */
function MissingPhase({ phase }: { phase: string }) {
  return (
    <Alert>
      <AlertTitle>No {phase} phase on this case</AlertTitle>
      <AlertDescription>
        This case was created before the {phase} phase existed. Ask an administrator to run the
        latest database migration, which adds it to every existing case.
      </AlertDescription>
    </Alert>
  );
}
