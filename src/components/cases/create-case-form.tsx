"use client";

import { useState, useTransition } from "react";
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
    <form onSubmit={onSubmit} noValidate className="max-w-2xl">
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

            <Field data-invalid={Boolean(form.formState.errors.procedureId)}>
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
                Type a new procedure to add it — it becomes a suggestion for every later case.
              </FieldDescription>
              <FieldError errors={[form.formState.errors.procedureId]} />
            </Field>

            <Field data-invalid={Boolean(form.formState.errors.procedureTypeId)}>
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
              <FieldError errors={[form.formState.errors.procedureTypeId]} />
            </Field>

            <Field data-invalid={Boolean(form.formState.errors.surgeryDate)}>
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

            <Field>
              <FieldLabel htmlFor="followupAvailability">Follow-up availability</FieldLabel>
              <Input
                id="followupAvailability"
                placeholder="e.g. 1M / 3M / 6M / 12M"
                {...form.register("followupAvailability")}
              />
              <FieldDescription>
                Optional note on which follow-ups are expected. Actual visits are recorded
                separately.
              </FieldDescription>
            </Field>

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

            <FieldSet>
              <FieldLabel asChild>
                <legend>Consent for image use</legend>
              </FieldLabel>
              <FieldDescription>
                Leave as not recorded if consent has not been obtained yet. It is never assumed to
                be No.
              </FieldDescription>
              <Controller
                control={form.control}
                name="consent"
                render={({ field }) => (
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className="gap-3 pt-1"
                  >
                    {[
                      { value: "YES", label: "Yes" },
                      { value: "NO", label: "No" },
                      { value: "NOT_RECORDED", label: "Not recorded yet" },
                    ].map((option) => (
                      <div key={option.value} className="flex items-center gap-2">
                        <RadioGroupItem value={option.value} id={`consent-${option.value}`} />
                        <FieldLabel htmlFor={`consent-${option.value}`} className="font-normal">
                          {option.label}
                        </FieldLabel>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              />
            </FieldSet>

            {form.watch("consent") !== "NOT_RECORDED" ? (
              <Field>
                <FieldLabel htmlFor="consentNotes">Consent notes</FieldLabel>
                <Textarea id="consentNotes" rows={3} {...form.register("consentNotes")} />
              </Field>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Create case
              </Button>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>
    </form>
  );
}
