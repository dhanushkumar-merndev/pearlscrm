import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { InviteUserDialog } from "@/components/users/invite-user-dialog";
import { UsersTable } from "@/components/users/users-table";
import { requirePermission } from "@/server/auth/session";
import { listUsers } from "@/server/actions/users";

export const metadata: Metadata = { title: "Users & Access" };

export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  const actor = await requirePermission("user:manage");

  const params = await searchParams;
  const raw = Array.isArray(params.page) ? params.page[0] : params.page;
  const page = Math.max(1, Number.parseInt(raw ?? "1", 10) || 1);

  const result = await listUsers({ page });

  return (
    <>
      <PageHeader
        title="Users & Access"
        description="Accounts are created by invitation only. There is no public registration."
        actions={<InviteUserDialog />}
      />

      <UsersTable result={result} currentUserId={actor.id} />
    </>
  );
}
