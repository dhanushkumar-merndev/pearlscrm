import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { DashboardDataPanel } from "@/components/dashboard/dashboard-data";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { requireUser } from "@/server/auth/session";

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

      <DashboardDataPanel isAdmin={user.role === "ADMIN"} />
    </>
  );
}
