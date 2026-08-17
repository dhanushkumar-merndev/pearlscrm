"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { signInSchema } from "@/lib/validation/schemas";
import { signIn } from "@/server/actions/auth";

type FormValues = z.input<typeof signInSchema>;

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);

    startTransition(async () => {
      const result = await signIn(values);

      if (!result.ok) {
        setFormError(result.error.message);
        return;
      }

      // `refresh` first so the new session cookie is picked up by the server
      // before the protected route renders.
      router.refresh();
      router.replace(next.startsWith("/") ? next : "/dashboard");
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Accounts are created by an administrator. There is no public registration.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <AlertTitle>Unable to sign in</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <Field data-invalid={Boolean(form.formState.errors.email)}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                aria-invalid={Boolean(form.formState.errors.email)}
                {...form.register("email")}
              />
              <FieldError errors={[form.formState.errors.email]} />
            </Field>

            <Field data-invalid={Boolean(form.formState.errors.password)}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  aria-invalid={Boolean(form.formState.errors.password)}
                  className="pr-10"
                  {...form.register("password")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <FieldError errors={[form.formState.errors.password]} />
            </Field>

            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Sign in
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
