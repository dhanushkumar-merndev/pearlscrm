import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { CasesDataPanel } from "@/components/cases/cases-data-panel";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Cases" };

export default async function CasesPage() {
  const user = await requireUser();

  return (
    <>
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

      <CasesDataPanel role={user.role} />
    </>
  );
}
