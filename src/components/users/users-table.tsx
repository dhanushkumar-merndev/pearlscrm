"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTimestamp } from "@/lib/dates";
import { ROLE_LABELS } from "@/lib/permissions";
import { ROLE_CODES, type ProfileWithRole, type RoleCode } from "@/lib/types";
import { updateUser } from "@/server/actions/users";

/**
 * User administration table.
 *
 * Disabling an account revokes its live sessions server-side, so access ends on
 * the next request rather than at the next token refresh.
 */
export function UsersTable({
  users,
  currentUserId,
}: {
  users: ProfileWithRole[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const apply = (userId: string, changes: { roleCode?: RoleCode; isActive?: boolean }) => {
    startTransition(async () => {
      const result = await updateUser({ userId, ...changes });

      if (!result.ok) {
        toast.error(result.error.message);
        router.refresh();
        return;
      }

      toast.success("User updated");
      router.refresh();
    });
  };

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
            <TableHead>Active</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {users.map((user) => {
            const isSelf = user.id === currentUserId;

            return (
              <TableRow key={user.id}>
                <TableCell className="font-medium">
                  {user.display_name}
                  {isSelf ? (
                    <Badge variant="secondary" className="ml-2">
                      You
                    </Badge>
                  ) : null}
                </TableCell>

                <TableCell className="text-muted-foreground max-w-56 truncate">
                  {user.email ?? "—"}
                </TableCell>

                <TableCell>
                  <Select
                    value={user.role_code}
                    disabled={pending || isSelf}
                    onValueChange={(value) => apply(user.id, { roleCode: value as RoleCode })}
                  >
                    <SelectTrigger className="w-40" aria-label={`Role for ${user.display_name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_CODES.map((code) => (
                        <SelectItem key={code} value={code}>
                          {ROLE_LABELS[code]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>

                <TableCell className="hidden tabular-nums lg:table-cell">
                  {user.last_sign_in_at ? formatTimestamp(user.last_sign_in_at) : "Never"}
                </TableCell>

                <TableCell>
                  {isSelf ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-block">
                          <Switch checked disabled aria-label="Your account is active" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>You cannot disable your own account.</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Switch
                      checked={user.is_active}
                      disabled={pending}
                      aria-label={`${user.display_name} active`}
                      onCheckedChange={(checked) => apply(user.id, { isActive: checked })}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
