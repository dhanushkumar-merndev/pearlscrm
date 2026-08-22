import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { ProfileForms } from "@/components/app/profile-forms";
import { requireUser } from "@/server/auth/session";
import { getAvatarReadUrl } from "@/server/services/avatar";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const avatarUrl = await getAvatarReadUrl(user.avatarObjectKey);

  return (
    <>
      <PageHeader
        title="Profile"
        description="Your own account. Role and access are managed by an administrator."
      />

      <ProfileForms
        displayName={user.displayName}
        email={user.email}
        role={user.role}
        avatarUrl={avatarUrl}
      />
    </>
  );
}
