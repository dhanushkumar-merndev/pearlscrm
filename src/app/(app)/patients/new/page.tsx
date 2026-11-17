import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { RegisterPatientForm } from "@/components/patients/register-patient-form";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/session";
import { getUserBranchId, listBranches, listDoctors } from "@/server/queries/patients";

export const metadata: Metadata = { title: "Register patient" };

export default async function RegisterPatientPage() {
  const user = await requirePermission("patient:create");
  const [branches, doctors, branchId] = await Promise.all([
    listBranches(),
    listDoctors(),
    getUserBranchId(user.id),
  ]);

  return (
    <>
      <PageHeader
        title="Register patient"
        description="First visit, referral, prescription and treatment plan."
        actions={
          <Button asChild variant="outline">
            <Link href="/patients">Cancel</Link>
          </Button>
        }
      />
      <RegisterPatientForm role={user.role} branches={branches} doctors={doctors} defaultBranchId={branchId} />
    </>
  );
}
