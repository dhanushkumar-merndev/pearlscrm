import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/app/page-header";
import { RealtimeRefresh } from "@/components/app/realtime-refresh";
import { CasesFilters } from "@/components/cases/cases-filters";
import { CasesTable } from "@/components/cases/cases-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { can } from "@/lib/permissions";
import { caseListQuerySchema } from "@/lib/validation/schemas";
import { requireUser } from "@/server/auth/session";
import { listCases } from "@/server/queries/cases";
import { listMasterValues } from "@/server/services/master-data";

export const metadata: Metadata = { title: "Cases" };

export default async function CasesPage({ searchParams }: PageProps<"/cases">) {
  const user = await requireUser();
  const params = await searchParams;

  return (
    <>
      <RealtimeRefresh
        channel="cases-list"
        tables={[{ table: "cases" }, { table: "case_visits" }]}
      />

      <PageHeader
        title="Cases"
        description="Search, filter and open clinical cases."
        actions={
          can(user.role, "case:create") ? (
            <Button asChild>
              <Link href="/cases/new">Create Case</Link>
            </Button>
          ) : null
        }
      />

      <Suspense fallback={<Skeleton className="h-28 w-full" />}>
        <Filters />
      </Suspense>

      <Suspense key={JSON.stringify(params)} fallback={<TableSkeleton />}>
        <Results searchParams={params} />
      </Suspense>
    </>
  );
}

async function Filters() {
  const [procedures, procedureTypes, tags] = await Promise.all([
    listMasterValues({ table: "procedures" }),
    listMasterValues({ table: "procedure_types" }),
    listMasterValues({ table: "clinical_tags" }),
  ]);

  return <CasesFilters procedures={procedures} procedureTypes={procedureTypes} tags={tags} />;
}

async function Results({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // Unparseable filters fall back to defaults rather than erroring the page.
  const parsed = caseListQuerySchema.safeParse(flatten(searchParams));
  const query = parsed.success ? parsed.data : caseListQuerySchema.parse({});

  const result = await listCases(query);

  return <CasesTable result={result} query={query} />;
}

function flatten(params: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(
    Object.entries(params)
      .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
      .filter(([, value]) => value !== undefined && value !== ""),
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}
