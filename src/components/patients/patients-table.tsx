"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatClinicDate } from "@/lib/dates";
import { currentAge } from "@/lib/file-id";
import type { PatientListResult } from "@/server/queries/patients";

const SEX_LABEL = { FEMALE: "F", MALE: "M", OTHER: "Other" } as const;

export function PatientsTable({ result, searching }: { result: PatientListResult; searching: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));

  const goTo = (page: number) => {
    const next = new URLSearchParams(searchParams.toString());
    if (page <= 1) next.delete("page");
    else next.set("page", String(page));
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  if (result.rows.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Users aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{searching ? "No matching patients" : "No patients yet"}</EmptyTitle>
          <EmptyDescription>
            {searching
              ? "Check the File ID, or search by name or phone instead."
              : "Register the first patient to give them a branch File ID."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Age / Sex</TableHead>
              <TableHead className="hidden lg:table-cell">Referred for</TableHead>
              <TableHead>Treatments</TableHead>
              <TableHead className="hidden md:table-cell">Last visit</TableHead>
              <TableHead className="hidden sm:table-cell">Next visit</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => {
              const age = currentAge(row.age_years, row.age_recorded_on);
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-medium tabular-nums">
                    <Link href={`/patients/${row.id}`} className="hover:underline">
                      {row.file_id}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-56 truncate">{row.full_name}</TableCell>
                  <TableCell className="hidden md:table-cell tabular-nums">
                    {age ?? "—"}
                    {row.sex ? ` / ${SEX_LABEL[row.sex]}` : ""}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{row.referred_for_name ?? "—"}</TableCell>
                  <TableCell>
                    {row.active_treatments > 0 ? (
                      <Badge variant="secondary">{row.active_treatments} active</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        {row.total_treatments === 0 ? "None" : `${row.total_treatments} closed`}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell tabular-nums">
                    {formatClinicDate(row.last_visit_date)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell tabular-nums">
                    {formatClinicDate(row.next_visit_date)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/patients/${row.id}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          Showing {(result.page - 1) * result.pageSize + 1}–
          {Math.min(result.page * result.pageSize, result.total)} of {result.total} patient
          {result.total === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={result.page <= 1} onClick={() => goTo(result.page - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground text-sm tabular-nums">
            Page {result.page} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={result.page >= pageCount}
            onClick={() => goTo(result.page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
