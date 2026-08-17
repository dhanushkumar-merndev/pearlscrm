import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { InviteUserDialog } from "@/components/users/invite-user-dialog";
import { UsersTable } from "@/components/users/users-table";
import { requirePermission } from "@/server/auth/session";
import { listUsers } from "@/server/actions/users";

export const metadata: Metadata = { title: "Users & Access" };

export default async function UsersPage() {
  const actor = await requirePermission("user:manage");
  const users = await listUsers();

  return (
    <>
      <PageHeader
        title="Users & Access"
        description="Accounts are created by invitation only. There is no public registration."
        actions={<InviteUserDialog />}
      />

      <UsersTable users={users} currentUserId={actor.id} />
    </>
  );
}
