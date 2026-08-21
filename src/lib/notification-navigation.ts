import type { AppNotification } from "@/lib/types";

/** Resolves each notification to the case area where the action belongs. */
export function notificationHref(notification: AppNotification): string {
  if (notification.type === "EDIT_REQUEST_CREATED") return "/approvals";
  if (!notification.case_id) return "/notifications";

  const tab =
    notification.edit_scope === "CASE_NOTES"
      ? "notes"
      : notification.edit_scope === "CASE_INFORMATION"
        ? "overview"
        : notification.visit_type === "BEFORE"
          ? "before"
          : notification.visit_type === "AFTER"
            ? "after"
            : notification.visit_type === "FOLLOW_UP"
              ? "followups"
              : "overview";

  return `/cases/${notification.case_id}?tab=${tab}`;
}
