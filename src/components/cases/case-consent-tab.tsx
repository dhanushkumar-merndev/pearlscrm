"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { toast } from "sonner";

import { ConsentBadge } from "@/components/app/status-badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatTimestamp } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { recordConsent } from "@/server/actions/consent";
import type { CaseDetail } from "@/server/queries/cases";
import type { RoleCode } from "@/lib/types";

/**
 * Consent for image use.
 *
 * Three distinct states, with "not recorded" never collapsed into "No". Every
 * answer is appended to a history rather than overwriting the previous one.
 */
export function CaseConsentTab({ detail, role }: { detail: CaseDetail; role: RoleCode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [answer, setAnswer] = useState<"yes" | "no" | null>(
    detail.consent === null ? null : detail.consent.image_use_consent ? "yes" : "no",
  );
  const [notes, setNotes] = useState("");

  const editable = can(role, "consent:record") && !detail.summary.archived_at;

  const submit = () => {
    if (answer === null) return;

    startTransition(async () => {
      const result = await recordConsent({
        caseId: detail.summary.id,
        imageUseConsent: answer === "yes",
        notes: notes.trim() || undefined,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success("Consent recorded");
      setNotes("");
      router.refresh();
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Consent for image use</CardTitle>
            <CardDescription>
              Recording a new answer adds to the consent history. Nothing is overwritten.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <FieldGroup>
              <Alert>
                <Info />
                <AlertTitle>Consent is not publication permission</AlertTitle>
                <AlertDescription>
                  Consent for image use does not make a case public. This library has no public
                  gallery, and access is governed by roles and authorization, not by consent.
                </AlertDescription>
              </Alert>

              <div className="flex items-center gap-3">
                <span className="text-muted-foreground text-sm">Current status:</span>
                <ConsentBadge state={detail.consentState} />
              </div>

              {editable ? (
                <>
                  <FieldSet>
                    <FieldLabel asChild>
                      <legend>Consent for image use</legend>
                    </FieldLabel>
                    <RadioGroup
                      value={answer ?? ""}
                      onValueChange={(value) => setAnswer(value as "yes" | "no")}
                      className="gap-3 pt-1"
                    >
                      {[
                        { value: "yes", label: "Yes — consent obtained" },
                        { value: "no", label: "No — consent not given" },
                      ].map((option) => (
                        <div key={option.value} className="flex items-center gap-2">
                          <RadioGroupItem value={option.value} id={`consent-tab-${option.value}`} />
                          <FieldLabel
                            htmlFor={`consent-tab-${option.value}`}
                            className="font-normal"
                          >
                            {option.label}
                          </FieldLabel>
                        </div>
                      ))}
                    </RadioGroup>
                    <FieldDescription>
                      There is no option to un-record consent — a change is recorded as a new
                      answer.
                    </FieldDescription>
                  </FieldSet>

                  <Field>
                    <FieldLabel htmlFor="consent-notes">Notes</FieldLabel>
                    <Textarea
                      id="consent-notes"
                      rows={3}
                      maxLength={2000}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Optional context for this consent record"
                    />
                  </Field>

                  <div>
                    <Button onClick={submit} disabled={pending || answer === null}>
                      {pending ? <Spinner /> : null}
                      Record consent
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  You do not have permission to change consent for this case.
                </p>
              )}
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Consent history</CardTitle>
          <CardDescription>Append-only record of every answer.</CardDescription>
        </CardHeader>

        <CardContent>
          {detail.consentHistory.length === 0 ? (
            <p className="text-muted-foreground text-sm">Consent has not been recorded yet.</p>
          ) : (
            <ol className="space-y-3">
              {detail.consentHistory.map((entry, index) => (
                <li key={entry.id} className="space-y-1 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <ConsentBadge state={entry.image_use_consent ? "YES" : "NO"} />
                    {index === 0 ? (
                      <span className="text-muted-foreground text-xs">Current</span>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {formatTimestamp(entry.recorded_at)}
                  </p>
                  {entry.notes ? <p className="text-sm whitespace-pre-line">{entry.notes}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
