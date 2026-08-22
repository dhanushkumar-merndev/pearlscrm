"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";

import { MasterDataCombobox } from "@/components/app/master-data-combobox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { todayIsoDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { createCaseSchema } from "@/lib/validation/schemas";
import { createCase } from "@/server/actions/cases";
import type { MasterValue, RoleCode } from "@/lib/types";

type FormValues = z.input<typeof createCaseSchema>;
type ParsedValues = z.output<typeof createCaseSchema>;

export function CreateCaseForm({ role, tags }: { role: RoleCode; tags: MasterValue[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<MasterValue[]>([]);

  const canCreateMasterData = can(role, "master_data:create");

  const form = useForm<FormValues, unknown, ParsedValues>({
    resolver: zodResolver(createCaseSchema),
    defaultValues: {
      procedureId: "",
      procedureTypeId: "",
      surgeryDate: "",
      followupAvailability: "",
      consent: "NOT_RECORDED",
      consentNotes: "",
      tagIds: [],
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);

    startTransition(async () => {
      const result = await createCase(values);

      if (!result.ok) {
        setFormError(result.error.message);
        return;
      }

      toast.success(`Case ${result.data.caseNumber} created`);
      // Images are deliberately not part of the create transaction: the user
      // lands on the case and uploads from there.
      router.push(`/cases/${result.data.caseId}`);
    });
  });

  const addTag = (tag: MasterValue | null) => {
    if (!tag) return;
    if (selectedTags.some((existing) => existing.id === tag.id)) return;

    const next = [...selectedTags, tag];
    setSelectedTags(next);
    form.setValue(
      "tagIds",
      next.map((item) => item.id),
    );
  };

  const removeTag = (id: string) => {
    const next = selectedTags.filter((tag) => tag.id !== id);
    setSelectedTags(next);
    form.setValue(
      "tagIds",
      next.map((item) => item.id),
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="w-full">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left 2 Columns: Core Form */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Case information</CardTitle>
              <CardDescription>
                Procedure, procedure type and date of surgery are required. Images and case notes are
                added after the case exists.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <FieldGroup>
                {formError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Could not create the case</AlertTitle>
                    <AlertDescription>{formError}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field data-invalid={Boolean(form.formState.errors.procedureId)} className="sm:col-span-1">
                    <FieldLabel htmlFor="procedureId">Procedure</FieldLabel>
                    <Controller
                      control={form.control}
                      name="procedureId"
                      render={({ field }) => (
                        <MasterDataCombobox
                          id="procedureId"
                          table="procedures"
                          label="Procedure"
                          value={field.value || null}
                          onValueChange={(id) => field.onChange(id ?? "")}
                          placeholder="Select or type a procedure"
                          invalid={Boolean(form.formState.errors.procedureId)}
                          canCreate={canCreateMasterData}
                        />
                      )}
                    />
                    <FieldDescription>
                      Type to select or add a new procedure suggestion.
                    </FieldDescription>
                    <FieldError errors={[form.formState.errors.procedureId]} />
                  </Field>

                  <Field data-invalid={Boolean(form.formState.errors.procedureTypeId)} className="sm:col-span-1">
                    <FieldLabel htmlFor="procedureTypeId">Procedure type</FieldLabel>
                    <Controller
                      control={form.control}
                      name="procedureTypeId"
                      render={({ field }) => (
                        <MasterDataCombobox
                          id="procedureTypeId"
                          table="procedure_types"
                          label="Procedure type"
                          value={field.value || null}
                          onValueChange={(id) => field.onChange(id ?? "")}
                          placeholder="Primary or Revision"
                          invalid={Boolean(form.formState.errors.procedureTypeId)}
                          canCreate={canCreateMasterData}
                        />
                      )}
                    />
                    <FieldDescription>
                      Classification of the procedure.
                    </FieldDescription>
                    <FieldError errors={[form.formState.errors.procedureTypeId]} />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field data-invalid={Boolean(form.formState.errors.surgeryDate)} className="sm:col-span-1">
                    <FieldLabel htmlFor="surgeryDate">Date of surgery</FieldLabel>
                    <Input
                      id="surgeryDate"
                      type="date"
                      max={todayIsoDate()}
                      aria-invalid={Boolean(form.formState.errors.surgeryDate)}
                      {...form.register("surgeryDate")}
                    />
                    <FieldError errors={[form.formState.errors.surgeryDate]} />
                  </Field>

                  <Field className="sm:col-span-1">
                    <FieldLabel htmlFor="followupAvailability">Follow-up availability</FieldLabel>
                    <Input
                      id="followupAvailability"
                      placeholder="e.g. 1M / 3M / 6M / 12M"
                      {...form.register("followupAvailability")}
                    />
                    <FieldDescription>
                      Optional note on expected follow-up intervals.
                    </FieldDescription>
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="case-tags">Tags</FieldLabel>
                  <MasterDataCombobox
                    id="case-tags"
                    table="clinical_tags"
                    label="Tags"
                    value={null}
                    onValueChange={(_id, value) => addTag(value)}
                    placeholder={tags.length > 0 ? "Add a tag" : "Type to create the first tag"}
                    canCreate={canCreateMasterData}
                  />
                  {selectedTags.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {selectedTags.map((tag) => (
                        <Badge key={tag.id} variant="secondary" className="gap-1">
                          {tag.display_name}
                          <button
                            type="button"
                            onClick={() => removeTag(tag.id)}
                            className="hover:text-destructive ml-1 cursor-pointer"
                            aria-label={`Remove tag ${tag.display_name}`}
                          >
                            ×
                          </button>
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Image use consent</CardTitle>
              <CardDescription>
                Record patient consent for internal clinical photograph archiving and follow-up reviews.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <FieldSet>
                  <FieldDescription className="mb-3">
                    Leave as not recorded if consent has not been obtained yet. It is never assumed to be No.
                  </FieldDescription>
                  <Controller
                    control={form.control}
                    name="consent"
                    render={({ field }) => (
                      <RadioGroup
                        value={field.value}
                        onValueChange={field.onChange}
                        className="grid gap-3 sm:grid-cols-3"
                      >
                        {[
                          { value: "YES", label: "Yes", desc: "Consent confirmed" },
                          { value: "NO", label: "No", desc: "No image use" },
                          { value: "NOT_RECORDED", label: "Not recorded yet", desc: "Pending confirmation" },
                        ].map((option) => (
                          <label
                            key={option.value}
                            htmlFor={`consent-${option.value}`}
                            className={cn(
                              "border-border/60 hover:border-foreground/30 flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors",
                              field.value === option.value && "border-primary bg-primary/5 dark:bg-primary/10"
                            )}
                          >
                            <RadioGroupItem value={option.value} id={`consent-${option.value}`} className="mt-0.5" />
                            <div className="space-y-0.5">
                              <p className="text-sm font-medium leading-none">{option.label}</p>
                              <p className="text-muted-foreground text-xs">{option.desc}</p>
                            </div>
                          </label>
                        ))}
                      </RadioGroup>
                    )}
                  />
                </FieldSet>

                {/* eslint-disable-next-line react-hooks/incompatible-library -- RHF watch() cannot be memoized; skipping memoization of this form is intentional and safe. */}
                {form.watch("consent") !== "NOT_RECORDED" ? (
                  <Field>
                    <FieldLabel htmlFor="consentNotes">Consent notes</FieldLabel>
                    <Textarea
                      id="consentNotes"
                      rows={3}
                      placeholder="Additional notes on patient consent, limitations, or document references..."
                      {...form.register("consentNotes")}
                    />
                  </Field>
                ) : null}
              </FieldGroup>
            </CardContent>
          </Card>
        </div>

        {/* Right 1 Column: Protocol / Summary & Actions Card */}
        <div className="space-y-6 lg:col-span-1">
          <Card className="lg:sticky lg:top-20">
            <CardHeader>
              <CardTitle>Case initialization</CardTitle>
              <CardDescription>What happens upon creation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="text-muted-foreground space-y-3 text-xs">
                <li className="flex items-start gap-2.5">
                  <span className="bg-primary/10 text-primary mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold">1</span>
                  <span><strong>Sequential Case Number:</strong> An identifier (e.g. <code>RH-0004</code>) is atomically assigned.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="bg-primary/10 text-primary mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold">2</span>
                  <span><strong>Before & After Phases:</strong> 6 standard anatomical view slots will be initialized for secure uploads.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="bg-primary/10 text-primary mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold">3</span>
                  <span><strong>Clinical Records:</strong> Structured case notes, anatomical tracking, and audit logging are unlocked.</span>
                </li>
              </ul>

              <div className="border-t pt-4 space-y-2">
                <Button type="submit" disabled={pending} className="w-full">
                  {pending ? <Spinner /> : null}
                  Create case
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/cases">Cancel</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}

