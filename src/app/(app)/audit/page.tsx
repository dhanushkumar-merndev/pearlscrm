import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/app/page-header";
import { AuditFilters } from "@/components/audit/audit-filters";
import { AuditTable } from "@/components/audit/audit-table";
import { Skeleton } from "@/components/ui/skeleton";
import { auditQuerySchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/server/auth/session";
import { AUDIT_ACTION_OPTIONS, listAuditLogs } from "@/server/queries/audit";
import { listUsers } from "@/server/actions/users";

export const metadata: Metadata = { title: "Audit Logs" };

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requirePermission("audit:read");
  const params = await searchParams;

  const users = await listUsers();

  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="Append-only record of clinical and administrative activity. Clinical narrative and secrets are never written here."
      />

      <AuditFilters
        actions={AUDIT_ACTION_OPTIONS}
        users={users.map((user) => ({ id: user.id, name: user.display_name }))}
      />

      <Suspense key={JSON.stringify(params)} fallback={<Skeleton className="h-96 w-full" />}>
        <Results searchParams={params} />
      </Suspense>
    </>
  );
}

async function Results({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const flat = Object.fromEntries(
    Object.entries(searchParams)
      .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
      .filter(([, value]) => value !== undefined && value !== ""),
  );

  const parsed = auditQuerySchema.safeParse(flat);
  const query = parsed.success ? parsed.data : auditQuerySchema.parse({});

  const result = await listAuditLogs(query);

  return <AuditTable result={result} />;
}
