import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app/app-sidebar";
import { NavigationEventDispatcher } from "@/components/app/navigation-event-dispatcher";
import { NotificationBell } from "@/components/app/notification-bell";
import { QueryProvider } from "@/components/app/query-provider";
import { UserMenu } from "@/components/app/user-menu";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { getSessionUser } from "@/server/auth/session";
import { getAvatarReadUrl } from "@/server/services/avatar";

/**
 * Authenticated application shell.
 *
 * Re-checks the session server-side on every render — middleware only redirects
 * for convenience, it is not the boundary.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();

  if (!user) redirect("/sign-in");

  if (!user.isActive) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="text-lg font-semibold">Access disabled</h1>
          <p className="text-muted-foreground text-sm">
            This account has been disabled. Contact an administrator if you believe this is a
            mistake.
          </p>
        </div>
      </main>
    );
  }

  const avatarUrl = await getAvatarReadUrl(user.avatarObjectKey);

  return (
    <SidebarProvider>
      <QueryProvider userId={user.id}>
        <NavigationEventDispatcher />
        <AppSidebar role={user.role} />

        <SidebarInset>
          <header className="bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 md:px-8 lg:px-10">
            <SidebarTrigger className="-ml-1" />
            <div className="flex-1" />
            <NotificationBell userId={user.id} />
            <UserMenu displayName={user.displayName} email={user.email} role={user.role} avatarUrl={avatarUrl} />
          </header>

          <div className="flex flex-1 flex-col gap-6 px-4 py-4 md:px-8 md:py-6 lg:px-10 lg:py-8">{children}</div>
        </SidebarInset>
      </QueryProvider>
    </SidebarProvider>
  );
}
