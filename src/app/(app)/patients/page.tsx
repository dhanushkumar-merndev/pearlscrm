import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { PatientsSearch } from "@/components/patients/patients-search";
import { PatientsTable } from "@/components/patients/patients-table";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { patientListQuerySchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/server/auth/session";
import { listBranches, listPatients } from "@/server/queries/patients";

export const metadata: Metadata = { title: "Patients" };

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("patient:read");
  const raw = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  const parsed = patientListQuerySchema.safeParse(flat);
  const query = parsed.success ? parsed.data : patientListQuerySchema.parse({});

  const [result, branches] = await Promise.all([listPatients(query), listBranches()]);

  return (
    <>
      <PageHeader
        title="Patients"
        description="Every branch's patients. Type a File ID to open the full history."
        actions={
          can(user.role, "patient:create") ? (
            <Button asChild>
              <Link href="/patients/new">
                <UserPlus aria-hidden />
                Register patient
              </Link>
            </Button>
          ) : null
        }
      />
      <PatientsSearch branches={branches} />
      <PatientsTable result={result} searching={Boolean(query.q || query.branchId)} />
    </>
  );
}
