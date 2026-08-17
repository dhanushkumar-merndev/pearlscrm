"use client";

import { useState } from "react";

import { CaseOverviewTab } from "@/components/cases/case-overview-tab";
import { CaseConsentTab } from "@/components/cases/case-consent-tab";
import { CaseNotesTab } from "@/components/case-notes/case-notes-tab";
import { CaseReviewTab } from "@/components/cases/case-review-tab";
import { CaseAuditTab } from "@/components/cases/case-audit-tab";
import { VisitImagesPanel } from "@/components/clinical-images/visit-images-panel";
import { FollowupsTab } from "@/components/followups/followups-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can } from "@/lib/permissions";
import type { CaseDetail } from "@/server/queries/cases";
import type { ImageViewType, RoleCode } from "@/lib/types";

/**
 * Case navigation stays inside tabs rather than expanding the sidebar.
 */
export function CaseTabs({
  detail,
  viewTypes,
  role,
  maxImageBytes,
}: {
  detail: CaseDetail;
  viewTypes: ImageViewType[];
  role: RoleCode;
  maxImageBytes: number;
}) {
  const [tab, setTab] = useState("overview");

  const beforeVisit = detail.visits.find((visit) => visit.visit_type === "BEFORE") ?? null;
  const followups = detail.visits.filter((visit) => visit.visit_type === "FOLLOW_UP");
  const showAudit = can(role, "audit:read");

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-6">
      <div className="overflow-x-auto">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="before">Before</TabsTrigger>
          <TabsTrigger value="followups">
            Follow-ups
            {followups.length > 0 ? (
              <span className="text-muted-foreground ml-1 tabular-nums">({followups.length})</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="notes">Case Notes</TabsTrigger>
          <TabsTrigger value="consent">Consent</TabsTrigger>
          <TabsTrigger value="review">Expert Review</TabsTrigger>
          {showAudit ? <TabsTrigger value="audit">Audit History</TabsTrigger> : null}
        </TabsList>
      </div>

      <TabsContent value="overview">
        <CaseOverviewTab detail={detail} onNavigate={setTab} />
      </TabsContent>

      <TabsContent value="before">
        {beforeVisit ? (
          <VisitImagesPanel
            caseId={detail.summary.id}
            visit={beforeVisit}
            viewTypes={viewTypes}
            role={role}
            maxImageBytes={maxImageBytes}
            readOnly={Boolean(detail.summary.archived_at)}
          />
        ) : null}
      </TabsContent>

      <TabsContent value="followups">
        <FollowupsTab
          caseId={detail.summary.id}
          surgeryDate={detail.summary.surgery_date}
          followups={followups}
          viewTypes={viewTypes}
          role={role}
          maxImageBytes={maxImageBytes}
          readOnly={Boolean(detail.summary.archived_at)}
        />
      </TabsContent>

      <TabsContent value="notes">
        <CaseNotesTab detail={detail} role={role} />
      </TabsContent>

      <TabsContent value="consent">
        <CaseConsentTab detail={detail} role={role} />
      </TabsContent>

      <TabsContent value="review">
        <CaseReviewTab detail={detail} role={role} />
      </TabsContent>

      {showAudit ? (
        <TabsContent value="audit">
          <CaseAuditTab caseId={detail.summary.id} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
