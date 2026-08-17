"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/client";
import { resetPasswordSchema } from "@/lib/validation/schemas";
import { completePasswordReset } from "@/server/actions/auth";

type FormValues = z.input<typeof resetPasswordSchema>;

export function ResetPasswordForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    // Supabase may deliver the recovery token in the URL fragment, which never
    // reaches the server. Exchanging it here establishes the session cookie.
    const supabase = createClient();

    supabase.auth.getSession().then(({ data }) => {
      setReady(Boolean(data.session));
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady(true);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);

    startTransition(async () => {
      const result = await completePasswordReset(values);

      if (!result.ok) {
        setFormError(result.error.message);
        return;
      }

      router.refresh();
      router.replace("/dashboard");
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>Choose a strong password you do not use anywhere else.</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            {ready === false ? (
              <Alert variant="destructive">
                <AlertTitle>This link is no longer valid</AlertTitle>
                <AlertDescription>
                  Password reset links expire quickly. Request a new one to continue.
                </AlertDescription>
              </Alert>
            ) : null}

            {formError ? (
              <Alert variant="destructive">
                <AlertTitle>Unable to set password</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <Field data-invalid={Boolean(form.formState.errors.password)}>
              <FieldLabel htmlFor="password">New password</FieldLabel>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(form.formState.errors.password)}
                {...form.register("password")}
              />
              <FieldDescription>At least 12 characters.</FieldDescription>
              <FieldError errors={[form.formState.errors.password]} />
            </Field>

            <Field data-invalid={Boolean(form.formState.errors.confirmPassword)}>
              <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(form.formState.errors.confirmPassword)}
                {...form.register("confirmPassword")}
              />
              <FieldError errors={[form.formState.errors.confirmPassword]} />
            </Field>

            <Button type="submit" disabled={pending || ready === false}>
              {pending ? <Spinner /> : null}
              Save password
            </Button>

            {ready === false ? (
              <Button asChild variant="outline">
                <Link href="/forgot-password">Request a new link</Link>
              </Button>
            ) : null}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
