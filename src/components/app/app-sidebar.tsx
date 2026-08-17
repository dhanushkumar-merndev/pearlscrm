"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FolderOpen,
  LayoutDashboard,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { can, type Permission } from "@/lib/permissions";
import type { RoleCode } from "@/lib/types";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
};

const CLINICAL_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cases", label: "Cases", icon: FolderOpen },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/users", label: "Users & Access", icon: Users, permission: "user:manage" },
  { href: "/audit", label: "Audit Logs", icon: ScrollText, permission: "audit:read" },
  { href: "/settings/master-data", label: "Settings", icon: Settings, permission: "master_data:manage" },
];

export function AppSidebar({ role }: { role: RoleCode }) {
  const pathname = usePathname();

  const adminItems = ADMIN_NAV.filter((item) => !item.permission || can(role, item.permission));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/dashboard">
                <Image
                  src="/icon-512.png"
                  alt="Pearls Aesthetic Clinic logo"
                  width={44}
                  height={44}
                  className="h-11 w-11 shrink-0 rounded-full object-contain"
                  priority
                />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-serif text-base font-semibold">
                    Pearls Aesthetic
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    Clinic Library
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Clinical</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {CLINICAL_NAV.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {adminItems.length > 0 ? (
          <SidebarGroup className="mt-6">
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {adminItems.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
        <Link href={item.href}>
          <Icon aria-hidden />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

