"use client";

import Link from "next/link";

import { LogOut, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/lib/permissions";
import { signOut } from "@/server/actions/auth";
import type { RoleCode } from "@/lib/types";

export function UserMenu({
  displayName,
  email,
  role,
}: {
  displayName: string;
  email: string | null;
  role: RoleCode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2" aria-label="Account menu">
          <Avatar className="size-6">
            <AvatarFallback className="text-xs">{initials(displayName)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm sm:inline">{displayName}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{displayName}</span>
          {email ? (
            <span className="text-muted-foreground truncate text-xs font-normal">{email}</span>
          ) : null}
          <span className="text-muted-foreground text-xs font-normal">{ROLE_LABELS[role]}</span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserRound aria-hidden />
            Profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <form action={signOut}>
          <button type="submit" className="w-full">
            <DropdownMenuItem asChild>
              <span className="cursor-pointer">
                <LogOut aria-hidden />
                Sign out
              </span>
            </DropdownMenuItem>
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "U"
  );
}
