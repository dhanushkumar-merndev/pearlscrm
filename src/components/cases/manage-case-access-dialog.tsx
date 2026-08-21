"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { updateCaseAccess } from "@/server/actions/case-access";
import type { CaseAccessUser } from "@/server/queries/case-access";

export function ManageCaseAccessDialog({
  open,
  onOpenChange,
  caseId,
  caseNumber,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  caseNumber: string;
  users: CaseAccessUser[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initial = () =>
    new Set(users.filter((user) => user.assigned && user.isActive).map((user) => user.id));
  const [selected, setSelected] = useState<Set<string>>(initial);

  const toggle = (doctorId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(doctorId);
      else next.delete(doctorId);
      return next;
    });
  };

  const save = () => {
    startTransition(async () => {
      const result = await updateCaseAccess({
        caseId,
        userIds: [...selected],
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success(
        result.data.assignedCount === 1
          ? "1 user assigned"
          : `${result.data.assignedCount} users assigned`,
      );
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage case access</DialogTitle>
          <DialogDescription>
            Choose which Doctors and selected-case Viewers can open {caseNumber}. A Doctor can
            also access a case they created themselves.
          </DialogDescription>
        </DialogHeader>

        {users.length === 0 ? (
          <div className="text-muted-foreground rounded-md border border-dashed px-4 py-8 text-center text-sm">
            No Doctor or Viewer accounts are available. Create an account from Users &amp; Access
            first.
          </div>
        ) : (
          <ScrollArea className="max-h-72 rounded-md border">
            <ul className="divide-y">
              {users.map((user) => (
                <li key={user.id} className="flex items-center gap-3 px-3 py-3">
                  <Checkbox
                    id={`case-access-${user.id}`}
                    checked={selected.has(user.id)}
                    disabled={pending || !user.isActive}
                    onCheckedChange={(checked) => toggle(user.id, checked === true)}
                  />
                  <Label
                    htmlFor={`case-access-${user.id}`}
                    className="min-w-0 flex-1 justify-start font-normal"
                  >
                    <span className="truncate">{user.displayName}</span>
                    <Badge variant="outline">{user.role === "DOCTOR" ? "Doctor" : "Viewer"}</Badge>
                    {user.role === "VIEWER" && user.visibilityScope === "ALL" ? (
                      <Badge variant="secondary">All cases</Badge>
                    ) : null}
                    {!user.isActive ? <Badge variant="outline">Inactive</Badge> : null}
                  </Label>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}

        <p className="text-muted-foreground text-xs">
          This controls the Cases page, dashboard totals, case details, notes, and clinical images.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || users.length === 0}>
            {pending ? <Spinner /> : null}
            Save access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
