import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { NotificationList } from "@/components/notifications/notification-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { decodeNotificationCursor } from "@/lib/notification-cursor";
import { requireUser } from "@/server/auth/session";
import { listNotifications } from "@/server/queries/notifications";

export const metadata: Metadata = { title: "Notifications" };

/** The bell only holds unread items; this page is the full notification history. */
export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  await requireUser();
  const params = await searchParams;
  const before = firstParam(params.before);
  const after = before ? undefined : firstParam(params.after);
  const cursor = decodeNotificationCursor(before ?? after);
  const direction = after ? "newer" : "older";
  const result = await listNotifications({ cursor, direction });

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Opening an unread update marks it as read and takes you to the relevant case section or approval queue."
      />
      <Card>
        <CardContent className="p-0">
          <NotificationList notifications={result.notifications} />
        </CardContent>
      </Card>
      <NotificationPager nextCursor={result.nextCursor} previousCursor={result.previousCursor} />
    </>
  );
}

function NotificationPager({
  nextCursor,
  previousCursor,
}: {
  nextCursor: string | null;
  previousCursor: string | null;
}) {
  if (!nextCursor && !previousCursor) return null;

  return (
    <nav className="flex items-center justify-between" aria-label="Notification history">
      <Button variant="outline" size="sm" asChild disabled={!previousCursor}>
        {previousCursor ? (
          <Link href={`/notifications?after=${previousCursor}`} scroll={false}>
            <ChevronLeft aria-hidden /> Newer
          </Link>
        ) : (
          <span>
            <ChevronLeft aria-hidden /> Newer
          </span>
        )}
      </Button>
      <Button variant="outline" size="sm" asChild disabled={!nextCursor}>
        {nextCursor ? (
          <Link href={`/notifications?before=${nextCursor}`} scroll={false}>
            Older <ChevronRight aria-hidden />
          </Link>
        ) : (
          <span>
            Older <ChevronRight aria-hidden />
          </span>
        )}
      </Button>
    </nav>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
