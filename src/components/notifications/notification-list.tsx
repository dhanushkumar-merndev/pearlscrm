"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/dates";
import { notificationHref } from "@/lib/notification-navigation";
import { cn } from "@/lib/utils";
import { markNotificationRead } from "@/server/actions/notifications";
import type { AppNotification } from "@/lib/types";

/** A notification opens its case section and marks itself read as one user action. */
export function NotificationList({
  notifications,
  emptyMessage = "No notifications yet.",
  onNotificationOpened,
}: {
  notifications: AppNotification[];
  emptyMessage?: string;
  onNotificationOpened?: (notification: AppNotification) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const openNotification = (notification: AppNotification) => {
    onNotificationOpened?.(notification);

    startTransition(async () => {
      if (!notification.read_at) await markNotificationRead({ notificationId: notification.id });
      router.push(notificationHref(notification));
      router.refresh();
    });
  };

  if (notifications.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 p-8 text-center">
        <Inbox className="size-6" aria-hidden />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {notifications.map((notification) => (
        <li key={notification.id}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => openNotification(notification)}
            className={cn(
              "hover:bg-muted/60 focus-visible:ring-ring h-auto w-full justify-start rounded-none px-3 py-2.5 text-left whitespace-normal focus-visible:ring-2",
              !notification.read_at && "bg-primary/5",
            )}
          >
            <span className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  notification.read_at ? "bg-transparent" : "bg-primary",
                )}
                aria-hidden
              />
              <span className="min-w-0 space-y-0.5">
                <span className="block text-sm leading-snug font-medium">{notification.title}</span>
                {notification.body ? (
                  <span className="text-muted-foreground block text-xs leading-snug">
                    {notification.body}
                  </span>
                ) : null}
                <span className="text-muted-foreground block text-xs tabular-nums">
                  {formatTimestamp(notification.created_at)}
                  {notification.read_at ? "" : " · Unread"}
                </span>
              </span>
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
