import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { NotificationList } from "@/components/notifications/notification-list";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";
import { listNotifications } from "@/server/queries/notifications";

export const metadata: Metadata = { title: "Notifications" };

/** The bell only holds unread items; this page is the full notification history. */
export default async function NotificationsPage() {
  await requireUser();
  const notifications = await listNotifications(100);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Opening an unread update marks it as read and takes you to the relevant case section or approval queue."
      />
      <Card>
        <CardContent className="p-0">
          <NotificationList notifications={notifications} />
        </CardContent>
      </Card>
    </>
  );
}
