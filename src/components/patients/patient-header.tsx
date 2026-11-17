"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Phone, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";

import { type DoctorChoice } from "@/components/app/doctor-select";
import { EditPatientDialog } from "@/components/patients/edit-patient-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { formatClinicDate } from "@/lib/dates";
import { currentAge } from "@/lib/file-id";
import { can } from "@/lib/permissions";
import type { RoleCode } from "@/lib/types";
import type { PatientDetail } from "@/server/queries/patients";

const SEX = { FEMALE: "Female", MALE: "Male", OTHER: "Other" } as const;

export function referralSummary(patient: PatientDetail["patient"]): string | null {
  const by = patient.referred_by_name
    ? `Dr. ${patient.referred_by_name.replace(/^Dr\.?\s+/i, "")}`
    : patient.referral_source;
  if (!by && !patient.referred_for_name) return null;
  const parts = [by ? `Referred by ${by}` : "Referred", patient.referred_for_name ? `for ${patient.referred_for_name}` : null];
  return parts.filter(Boolean).join(" ");
}

export function PatientHeader({
  detail,
  role,
  doctors,
}: {
  detail: PatientDetail;
  role: RoleCode;
  doctors: DoctorChoice[];
}) {
  const { patient } = detail;
  const [editing, setEditing] = useState(false);
  const age = currentAge(patient.age_years, patient.age_recorded_on);
  const referral = referralSummary(patient);

  // The referral reminder: always in the header, and a toast the first time this
  // patient is opened in a browser session, so a doctor at another branch sees
  // who sent them and why before reading anything else.
  useEffect(() => {
    if (!referral) return;
    const key = `pearl.referral-shown.${patient.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage unavailable: show it every time rather than never.
    }
    toast.info(`${patient.file_id}: ${referral}`, { duration: 8000 });
  }, [patient.id, patient.file_id, referral]);

  return (
    <div className="space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/patients">Patients</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="tabular-nums">{patient.file_id}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight tabular-nums">{patient.file_id}</h1>
            <Badge variant="outline">
              {patient.branch_code} · {patient.branch_name}
            </Badge>
            {patient.archived_at ? <Badge variant="secondary">Archived</Badge> : null}
          </div>
          <p className="text-lg font-medium">{patient.full_name}</p>
          <dl className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="sr-only">Age and sex</dt>
              <dd className="text-foreground">
                {age !== null ? `${age} yrs` : "Age not recorded"}
                {patient.sex ? ` · ${SEX[patient.sex]}` : ""}
              </dd>
            </div>
            {patient.phone ? (
              <div className="flex items-center gap-1.5">
                <Phone className="size-3.5" aria-hidden />
                <dt className="sr-only">Phone</dt>
                <dd className="text-foreground tabular-nums">
                  <a href={`tel:${patient.phone.replace(/\s/g, "")}`} className="hover:underline">
                    {patient.phone}
                  </a>
                </dd>
              </div>
            ) : null}
            <div className="flex gap-1.5">
              <dt>First visit:</dt>
              <dd className="text-foreground tabular-nums">{formatClinicDate(patient.first_visit_date)}</dd>
            </div>
            {patient.next_visit_date ? (
              <div className="flex gap-1.5">
                <dt>Next visit:</dt>
                <dd className="text-foreground font-medium tabular-nums">{formatClinicDate(patient.next_visit_date)}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        {can(role, "patient:update") && !patient.archived_at ? (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            Edit details
          </Button>
        ) : null}
      </div>

      {referral ? (
        <Alert>
          <UserRoundCheck aria-hidden />
          <AlertTitle>{referral}</AlertTitle>
          <AlertDescription>
            {patient.referral_note ? <p className="whitespace-pre-line">{patient.referral_note}</p> : null}
            {patient.referred_by_name && patient.referral_source ? <p>Source: {patient.referral_source}</p> : null}
            {!patient.referral_note && !(patient.referred_by_name && patient.referral_source) ? (
              <p>Recorded at registration on {formatClinicDate(patient.first_visit_date ?? patient.created_at)}.</p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {editing ? (
        <EditPatientDialog open={editing} onOpenChange={setEditing} patient={patient} doctors={doctors} role={role} />
      ) : null}
    </div>
  );
}
