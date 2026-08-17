import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { CreateCaseForm } from "@/components/cases/create-case-form";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/session";
import { listMasterValues } from "@/server/services/master-data";

export const metadata: Metadata = { title: "Create case" };

export default async function CreateCasePage() {
  // Authorization is enforced here and again inside the action.
  const user = await requirePermission("case:create");

  const tags = await listMasterValues({ table: "clinical_tags" });

  return (
    <>
      <PageHeader
        title="Create case"
        description="A sequential case ID is generated automatically. No patient identifiers are recorded."
        actions={
          <Button asChild variant="outline">
            <Link href="/cases">Cancel</Link>
          </Button>
        }
      />

      <CreateCaseForm role={user.role} tags={tags} />
    </>
  );
}
