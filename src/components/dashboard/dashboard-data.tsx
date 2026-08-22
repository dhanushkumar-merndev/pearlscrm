"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarClock } from "lucide-react";

import { CaseStatusBadge, ConsentBadge, ReviewBadge } from "@/components/app/status-badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRealtime } from "@/hooks/use-realtime";
import { formatClinicDate } from "@/lib/dates";
import { CLINICAL_CACHE_TIME_MS } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import type { CaseListRow } from "@/lib/types";

type DashboardData = {
  metrics: {
    totalCases: number;
    activeFollowups: number;
    awaitingReview: number;
    completedCases: number;
    incompleteCases: number;
  };
  recentCases: CaseListRow[];
  followupAttention: Array<CaseListRow & { daysSinceLastActivity: number; reason: string }>;
};

const DASHBOARD_QUERY_KEY = ["dashboard"] as const;

async function fetchDashboard(): Promise<DashboardData> {
  const response = await fetch("/api/dashboard");
  if (!response.ok) throw new Error("Could not load the dashboard.");
  return (await response.json()) as DashboardData;
}

/**
 * Dashboard values stay in the current browser's TanStack cache for staff and
 * doctors. Administrators use the same cache but invalidate it from realtime
 * changes, so their operational view is kept current without route refreshes.
 */
export function DashboardDataPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const query = useQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: fetchDashboard,
    staleTime: isAdmin ? 0 : Infinity,
    gcTime: CLINICAL_CACHE_TIME_MS,
  });

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  const refreshAdminDashboard = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY });
    }, 400);
  }, [queryClient]);

  useRealtime({
    channel: "admin-dashboard",
    enabled: isAdmin,
    tables: [
      { table: "cases" },
      { table: "case_visits" },
      { table: "case_reviews" },
      { table: "case_consents" },
    ],
    onChange: refreshAdminDashboard,
  });

  if (!query.data && query.isPending) return <DashboardSkeleton />;

  if (!query.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Dashboard unavailable</AlertTitle>
        <AlertDescription>Refresh the page to try again.</AlertDescription>
      </Alert>
    );
  }

  const { metrics, recentCases, followupAttention } = query.data;
  const cards = [
    { label: "Total Cases", value: metrics.totalCases, href: "/cases?status=any" },
    { label: "Active Follow-ups", value: metrics.activeFollowups, href: "/cases?hasFollowups=yes" },
    { label: "Awaiting Expert Review", value: metrics.awaitingReview, href: "/cases?reviewStatus=PENDING" },
    { label: "Completed Cases", value: metrics.completedCases, href: "/cases?status=COMPLETED" },
    { label: "Incomplete Cases", value: metrics.incompleteCases, href: "/cases?completion=incomplete" },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((card, index) => (
          <Card key={card.label} className={cn("gap-0 py-0", index === cards.length - 1 && "col-span-2 md:col-span-1")}>
            <CardHeader className="px-4 pt-3 pb-0 sm:px-6 sm:pt-3">
              <CardDescription className="text-xs font-medium line-clamp-1 sm:text-sm">{card.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums sm:text-3xl">{card.value}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pt-2 pb-3 sm:px-6 sm:pt-2 sm:pb-3">
              <Link href={card.href} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">
                View cases <ArrowRight className="size-3" aria-hidden />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <RecentCases cases={recentCases} />
        <FollowupAttention rows={followupAttention} />
      </div>
    </>
  );
}

function RecentCases({ cases }: { cases: CaseListRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent cases</CardTitle>
        <CardDescription>The most recently created clinical cases.</CardDescription>
        <CardAction><Button asChild variant="ghost" size="sm"><Link href="/cases">All cases</Link></Button></CardAction>
      </CardHeader>
      <CardContent>
        {cases.length === 0 ? <Empty className="border-0"><EmptyHeader><EmptyTitle>No cases yet</EmptyTitle><EmptyDescription>Create the first clinical case to get started.</EmptyDescription></EmptyHeader></Empty> : (
          <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Case ID</TableHead><TableHead>Procedure</TableHead><TableHead className="hidden md:table-cell">Type</TableHead><TableHead className="hidden lg:table-cell">Surgery</TableHead><TableHead className="hidden lg:table-cell">Latest follow-up</TableHead><TableHead>Review</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
            {cases.map((row) => <TableRow key={row.id}><TableCell className="font-medium"><Link href={`/cases/${row.id}`} className="hover:underline">{row.case_number}</Link></TableCell><TableCell className="max-w-40 truncate">{row.procedure_name}</TableCell><TableCell className="hidden md:table-cell">{row.procedure_type_name}</TableCell><TableCell className="hidden tabular-nums lg:table-cell">{formatClinicDate(row.surgery_date)}</TableCell><TableCell className="hidden lg:table-cell">{row.latest_followup_label ?? "—"}</TableCell><TableCell><ReviewBadge status={row.review_status} /></TableCell><TableCell className="text-right"><Button asChild variant="ghost" size="sm"><Link href={`/cases/${row.id}`}>Open</Link></Button></TableCell></TableRow>)}
          </TableBody></Table></div>
        )}
      </CardContent>
    </Card>
  );
}

function FollowupAttention({ rows }: { rows: DashboardData["followupAttention"] }) {
  return (
    <Card><CardHeader><CardTitle>Follow-up attention</CardTitle><CardDescription>Active cases with no recorded follow-up for over a month. Review as clinically appropriate.</CardDescription></CardHeader><CardContent>
      {rows.length === 0 ? <Empty className="border-0"><EmptyHeader><EmptyMedia variant="icon"><CalendarClock /></EmptyMedia><EmptyTitle>Nothing outstanding</EmptyTitle><EmptyDescription>No active case is currently waiting on a follow-up record.</EmptyDescription></EmptyHeader></Empty> : (
        <ul className="divide-y">{rows.map((row) => <li key={row.id} className="flex items-center justify-between gap-3 py-3 first:pt-0"><div className="min-w-0 space-y-1"><div className="flex flex-wrap items-center gap-2"><Link href={`/cases/${row.id}`} className="font-medium hover:underline">{row.case_number}</Link><CaseStatusBadge status={row.status} /><ConsentBadge state={row.image_use_consent === null ? "NOT_RECORDED" : row.image_use_consent ? "YES" : "NO"} /></div><p className="text-muted-foreground truncate text-xs">{row.reason}</p></div><Badge variant="outline" className="shrink-0 tabular-nums">{row.daysSinceLastActivity} days</Badge></li>)}</ul>
      )}
    </CardContent></Card>
  );
}

function DashboardSkeleton() {
  return <><div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <Card key={index} className={cn("gap-2", index === 4 && "col-span-2 md:col-span-1")}><CardHeader className="p-3.5 sm:p-6"><Skeleton className="h-4 w-20 sm:w-24" /><Skeleton className="mt-2 h-7 w-10 sm:h-8 sm:w-12" /></CardHeader></Card>)}</div><div className="grid gap-6 xl:grid-cols-2"><TableCardSkeleton title="Recent cases" /><TableCardSkeleton title="Follow-up attention" /></div></>;
}

function TableCardSkeleton({ title }: { title: string }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="space-y-3">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-8 w-full" />)}</CardContent></Card>;
}
