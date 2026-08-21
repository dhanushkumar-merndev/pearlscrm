"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotificationList } from "@/components/notifications/notification-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useRealtime } from "@/hooks/use-realtime";
import {
  getNotificationFeed,
  markAllNotificationsRead,
} from "@/server/actions/notifications";
import type { AppNotification } from "@/lib/types";

/**
 * Safety net only. Notifications arrive over the realtime channel; this catches
 * the case where the socket dropped and reconnected while something landed.
 */
const FALLBACK_POLL_MS = 300_000;

/**
 * In-app notifications.
 *
 * Administrators are told when a phase's images are submitted or changed, and
 * when someone asks to reopen a locked section; requesters are told how their
 * request was decided. Notifications carry case numbers and section names only
 * — never clinical narrative.
 */
export function NotificationBell({ userId }: { userId: string }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [, startTransition] = useTransition();

  const load = useCallback(async () => {
    const result = await getNotificationFeed();
    if (!result.ok) return;

    setNotifications(result.data.notifications);
    setUnread(result.data.unread);
  }, []);

  useEffect(() => {
    // Fetch-on-mount plus a slow safety-net poll. State only changes inside the
    // awaited `load`, never synchronously in this effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();

    const timer = setInterval(() => void load(), FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // The row filter is belt and braces — RLS already restricts delivery to this
  // user's own notifications — but it also stops the server sending rows the
  // policy would only discard.
  useRealtime({
    channel: `notifications:${userId}`,
    tables: [{ table: "notifications", filter: `recipient_id=eq.${userId}` }],
    onChange: () => void load(),
  });

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void load();
  };

  const openNotification = (notification: AppNotification) => {
    setOpen(false);

    if (!notification.read_at) {
      setUnread((count) => Math.max(0, count - 1));
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell aria-hidden />
          {unread > 0 ? (
            <Badge
              variant="destructive"
              className="absolute -top-0.5 -right-0.5 size-4 justify-center rounded-full p-0 text-[10px] tabular-nums"
            >
              {unread > 9 ? "9+" : unread}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-88 p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <p className="text-sm font-medium">Notifications</p>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() =>
                startTransition(async () => {
                  setUnread(0);
                  await markAllNotificationsRead();
                  await load();
                  router.refresh();
                })
              }
            >
              <CheckCheck aria-hidden />
              Mark all read
            </Button>
          ) : null}
        </div>

        <Separator />

        {notifications === null ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <ScrollArea className="h-96">
            <NotificationList
              notifications={notifications}
              emptyMessage="No unread notifications."
              onNotificationOpened={openNotification}
            />
          </ScrollArea>
        )}

        <Separator />
        <div className="p-2">
          <Button asChild variant="ghost" size="sm" className="w-full justify-start">
            <a href="/notifications">View all notifications</a>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
