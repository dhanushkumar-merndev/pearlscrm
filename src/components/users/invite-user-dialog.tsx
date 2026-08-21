"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ROLE_LABELS } from "@/lib/permissions";
import { ROLE_CODES, type RoleCode } from "@/lib/types";
import { createUser } from "@/server/actions/users";

/** Creates a new account with a password set by the administrator. */
export function InviteUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [roleCode, setRoleCode] = useState<RoleCode>("DOCTOR");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);

    startTransition(async () => {
      const result = await createUser({ email, displayName, password, roleCode });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      toast.success("Account created");
      setEmail("");
      setDisplayName("");
      setPassword("");
      setRoleCode("DOCTOR");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden />
          Create user
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a user</DialogTitle>
          <DialogDescription>
            Give the person their sign-in email and initial password. Passwords are never sent by
            email, and there is no self-service password reset. Their role governs what they can do,
            enforced on the server and in the database.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <Field>
            <FieldLabel htmlFor="invite-name">Name</FieldLabel>
            <Input
              id="invite-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="off"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="invite-password">Password</FieldLabel>
            <Input
              id="invite-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
            <FieldDescription>At least 12 characters.</FieldDescription>
            <FieldError />
          </Field>

          <Field>
            <FieldLabel htmlFor="invite-role">Role</FieldLabel>
            <Select value={roleCode} onValueChange={(value) => setRoleCode(value as RoleCode)}>
              <SelectTrigger id="invite-role" className="w-full">
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
            <FieldDescription>
              Viewers are read-only. Doctors manage clinical cases, images, and notes.
              Administrators also manage users and settings.
            </FieldDescription>
            <FieldError />
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              pending || email.trim() === "" || displayName.trim() === "" || password.length < 12
            }
          >
            {pending ? <Spinner /> : null}
            Create account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
