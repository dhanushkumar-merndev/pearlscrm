"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ROLE_LABELS } from "@/lib/permissions";
import { changeOwnPassword, updateOwnProfile } from "@/server/actions/profile";
import type { RoleCode } from "@/lib/types";

const MIN_PASSWORD_LENGTH = 12;

/**
 * The signed-in user's own account.
 *
 * Only the two things a person may change about themselves. Role and active
 * status are shown read-only — they are an administrator's decision, and the
 * database refuses to let this page write them regardless.
 */
export function ProfileForms({
  displayName,
  email,
  role,
}: {
  displayName: string;
  email: string | null;
  role: RoleCode;
}) {
  const router = useRouter();

  const [name, setName] = useState(displayName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, startSaveName] = useTransition();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, startSavePassword] = useTransition();

  const nameDirty = name.trim() !== displayName && name.trim() !== "";

  const passwordReady =
    currentPassword !== "" &&
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    confirmPassword !== "";

  const mismatch = confirmPassword !== "" && newPassword !== confirmPassword;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="size-4" aria-hidden />
            Your details
          </CardTitle>
          <CardDescription>
            Your name appears against everything you record — uploads, notes and approvals.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <FieldGroup>
            {nameError ? (
              <p className="text-destructive text-sm" role="alert">
                {nameError}
              </p>
            ) : null}

            <Field>
              <FieldLabel htmlFor="profile-name">Display name</FieldLabel>
              <Input
                id="profile-name"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="profile-email">Email address</FieldLabel>
              <Input id="profile-email" value={email ?? "—"} readOnly disabled />
              <FieldDescription>
                Contact an administrator to change the address on your account.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="profile-role">Role</FieldLabel>
              <Input id="profile-role" value={ROLE_LABELS[role]} readOnly disabled />
              <FieldDescription>Only an administrator can change your role.</FieldDescription>
            </Field>

            <Button
              className="w-fit"
              disabled={!nameDirty || savingName}
              onClick={() => {
                setNameError(null);
                startSaveName(async () => {
                  const result = await updateOwnProfile({ displayName: name });

                  if (!result.ok) {
                    setNameError(result.error.message);
                    return;
                  }

                  toast.success("Profile updated");
                  router.refresh();
                });
              }}
            >
              {savingName ? <Spinner /> : null}
              Save changes
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden />
            Password
          </CardTitle>
          <CardDescription>
            Your current password is required — that is what stops someone with a borrowed session
            from locking you out.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <FieldGroup>
            {passwordError ? (
              <p className="text-destructive text-sm" role="alert">
                {passwordError}
              </p>
            ) : null}

            <Field>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <FieldDescription>
                At least {MIN_PASSWORD_LENGTH} characters.
              </FieldDescription>
            </Field>

            <Field data-invalid={mismatch}>
              <FieldLabel htmlFor="confirm-password">Repeat new password</FieldLabel>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={mismatch}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
              <FieldError>{mismatch ? "The two passwords do not match." : null}</FieldError>
            </Field>

            <Button
              className="w-fit"
              disabled={!passwordReady || mismatch || savingPassword}
              onClick={() => {
                setPasswordError(null);
                startSavePassword(async () => {
                  const result = await changeOwnPassword({
                    currentPassword,
                    newPassword,
                    confirmPassword,
                  });

                  if (!result.ok) {
                    setPasswordError(result.error.message);
                    return;
                  }

                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                  toast.success("Password changed");
                });
              }}
            >
              {savingPassword ? <Spinner /> : null}
              Change password
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  );
}
