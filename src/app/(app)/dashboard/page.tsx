import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, CalendarClock } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { CaseStatusBadge, ConsentBadge, ReviewBadge } from "@/components/app/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatClinicDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requireUser } from "@/server/auth/session";
import {
  getDashboardMetrics,
  getFollowupAttention,
  getRecentCases,
} from "@/server/queries/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Operational overview of the clinical case library."
        actions={
          can(user.role, "case:create") ? (
            <Button asChild>
              <Link href="/cases/new">Create Case</Link>
            </Button>
          ) : null
        }
      />

      <Suspense fallback={<MetricsSkeleton />}>
        <Metrics />
      </Suspense>

      <div className="grid gap-6 xl:grid-cols-2">
        <Suspense fallback={<TableCardSkeleton title="Recent cases" />}>
          <RecentCases />
        </Suspense>

        <Suspense fallback={<TableCardSkeleton title="Follow-up attention" />}>
          <FollowupAttention />
        </Suspense>
      </div>
    </>
  );
}

async function Metrics() {
  const metrics = await getDashboardMetrics();

  const cards = [
    { label: "Total Cases", value: metrics.totalCases, href: "/cases?status=any" },
    { label: "Active Follow-ups", value: metrics.activeFollowups, href: "/cases?hasFollowups=yes" },
    { label: "Awaiting Expert Review", value: metrics.awaitingReview, href: "/cases?reviewStatus=PENDING" },
    { label: "Completed Cases", value: metrics.completedCases, href: "/cases?status=COMPLETED" },
    { label: "Incomplete Cases", value: metrics.incompleteCases, href: "/cases?completion=incomplete" },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.label} className="gap-2">
          <CardHeader className="pb-0">
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{card.value}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href={card.href}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
            >
              View cases
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

async function RecentCases() {
  const cases = await getRecentCases();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent cases</CardTitle>
        <CardDescription>The most recently created clinical cases.</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/cases">All cases</Link>
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent>
        {cases.length === 0 ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyTitle>No cases yet</EmptyTitle>
              <EmptyDescription>Create the first clinical case to get started.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case ID</TableHead>
                  <TableHead>Procedure</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Surgery</TableHead>
                  <TableHead className="hidden lg:table-cell">Latest follow-up</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {cases.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <Link href={`/cases/${row.id}`} className="hover:underline">
                        {row.case_number}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-40 truncate">{row.procedure_name}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {row.procedure_type_name}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell tabular-nums">
                      {formatClinicDate(row.surgery_date)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {row.latest_followup_label ?? "—"}
                    </TableCell>
                    <TableCell>
                      <ReviewBadge status={row.review_status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/cases/${row.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

async function FollowupAttention() {
  const rows = await getFollowupAttention();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Follow-up attention</CardTitle>
        <CardDescription>
          Active cases with no recorded follow-up for over a month. Review as clinically
          appropriate.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {rows.length === 0 ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarClock />
              </EmptyMedia>
              <EmptyTitle>Nothing outstanding</EmptyTitle>
              <EmptyDescription>
                No active case is currently waiting on a follow-up record.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/cases/${row.id}`} className="font-medium hover:underline">
                      {row.case_number}
                    </Link>
                    <CaseStatusBadge status={row.status} />
                    <ConsentBadge
                      state={
                        row.image_use_consent === null
                          ? "NOT_RECORDED"
                          : row.image_use_consent
                            ? "YES"
                            : "NO"
                      }
                    />
                  </div>
                  <p className="text-muted-foreground truncate text-xs">{row.reason}</p>
                </div>

                <Badge variant="outline" className="shrink-0 tabular-nums">
                  {row.daysSinceLastActivity} days
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MetricsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {Array.from({ length: 5 }).map((_, index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-8 w-12" />
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

function TableCardSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
