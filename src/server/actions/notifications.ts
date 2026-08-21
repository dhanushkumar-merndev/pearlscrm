"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors";
import { markNotificationReadSchema } from "@/lib/validation/schemas";
import type { ActionInput } from "@/lib/validation/action-input";
import { requireUser } from "@/server/auth/session";
import {
  countUnreadNotifications,
  listUnreadNotifications,
} from "@/server/queries/notifications";
import { actionResult, type ActionResult } from "@/server/actions/result";
import type { AppNotification } from "@/lib/types";

/**
 * In-app notifications.
 *
 * Every read and write here runs as the signed-in user, so RLS restricts each
 * one to that user's own rows — a recipient id is never accepted from a client.
 */

export type NotificationFeed = {
  notifications: AppNotification[];
  unread: number;
};

export async function getNotificationFeed(): Promise<ActionResult<NotificationFeed>> {
  return actionResult(async () => {
    await requireUser();

    const [notifications, unread] = await Promise.all([
      listUnreadNotifications(),
      countUnreadNotifications(),
    ]);

    return { notifications, unread };
  });
}

export async function markNotificationRead(
  input: ActionInput<typeof markNotificationReadSchema>,
): Promise<ActionResult<{ read: true }>> {
  return actionResult(async () => {
    await requireUser();
    const data = markNotificationReadSchema.parse(input);

    const supabase = await createSupabaseServerClient();

    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.notificationId)
      .is("read_at", null);

    if (error) throw new AppError("INTERNAL", "The notification could not be updated.");

    revalidatePath("/dashboard");

    return { read: true as const };
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult<{ read: true }>> {
  return actionResult(async () => {
    await requireUser();

    const supabase = await createSupabaseServerClient();

    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);

    if (error) throw new AppError("INTERNAL", "The notifications could not be updated.");

    revalidatePath("/dashboard");

    return { read: true as const };
  });
}
