import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app/app-sidebar";
import { UserMenu } from "@/components/app/user-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { getSessionUser } from "@/server/auth/session";

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

  return (
    <SidebarProvider>
      <AppSidebar role={user.role} />

      <SidebarInset>
        <header className="bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="flex-1" />
          <UserMenu displayName={user.displayName} email={user.email} role={user.role} />
        </header>

        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
