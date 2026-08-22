"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { CasesFilters } from "@/components/cases/cases-filters";
import { CasesTable } from "@/components/cases/cases-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useRealtime } from "@/hooks/use-realtime";
import { CLINICAL_CACHE_TIME_MS } from "@/lib/query-client";
import { caseListQuerySchema, type CaseListQuery } from "@/lib/validation/schemas";
import type { MasterValue, RoleCode } from "@/lib/types";
import type { CaseListResult } from "@/server/queries/cases";

type CaseOptions = { procedures: MasterValue[]; procedureTypes: MasterValue[]; tags: MasterValue[] };
type CasePage = { result: CaseListResult; query: CaseListQuery; showCreator: boolean };

const OPTIONS_KEY = ["case-filter-options"] as const;
const CASE_LIST_KEY = ["case-list"] as const;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load cases.");
  return (await response.json()) as T;
}

/** Client-cached cases list. Filter/search URL changes remain server-authoritative. */
export function CasesDataPanel({ role }: { role: RoleCode }) {
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const parsed = caseListQuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
  const query = parsed.success ? parsed.data : caseListQuerySchema.parse({});
  const isAdmin = role === "ADMIN";
  const queryClient = useQueryClient();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const options = useQuery({
    queryKey: OPTIONS_KEY,
    queryFn: () => fetchJson<CaseOptions>("/api/cases/options"),
    staleTime: Infinity,
    gcTime: CLINICAL_CACHE_TIME_MS,
  });
  const cases = useQuery({
    queryKey: [...CASE_LIST_KEY, queryString],
    queryFn: () => fetchJson<CasePage>(`/api/cases${queryString ? `?${queryString}` : ""}`),
    staleTime: Infinity,
    gcTime: CLINICAL_CACHE_TIME_MS,
  });

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  const refreshAdminCases = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void queryClient.invalidateQueries({ queryKey: CASE_LIST_KEY });
    }, 400);
  }, [queryClient]);

  useRealtime({
    channel: "admin-cases-list",
    enabled: isAdmin,
    tables: [
      { table: "cases" },
      { table: "case_visits" },
      { table: "case_reviews" },
      { table: "case_consents" },
      { table: "case_tags" },
    ],
    onChange: refreshAdminCases,
  });

  if (options.isPending || cases.isPending) return <CasesPanelSkeleton />;
  if (!options.data || !cases.data) {
    return <Alert variant="destructive"><AlertTitle>Cases unavailable</AlertTitle><AlertDescription>Refresh the page to try again.</AlertDescription></Alert>;
  }

  return (
    <>
      <CasesFilters {...options.data} />
      <CasesTable result={cases.data.result} query={query} showCreator={cases.data.showCreator} />
    </>
  );
}

function CasesPanelSkeleton() {
  return <><Skeleton className="h-28 w-full" /><div className="space-y-3"><Skeleton className="h-10 w-full" />{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div></>;
}
