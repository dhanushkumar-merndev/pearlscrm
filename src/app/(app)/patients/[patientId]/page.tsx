import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PatientHeader } from "@/components/patients/patient-header";
import { PatientTabs } from "@/components/patients/patient-tabs";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/server/auth/session";
import { getPatientDetail, getUserBranchId, listBranches, listDoctors } from "@/server/queries/patients";
import { recordAudit } from "@/server/services/audit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ patientId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { patientId } = await params;
  if (!UUID.test(patientId)) return { title: "Patient" };
  try {
    // The title carries the File ID only — never the patient's name.
    const detail = await getPatientDetail(patientId);
    return { title: detail.patient.file_id };
  } catch {
    return { title: "Patient" };
  }
}

export default async function PatientPage({ params }: Props) {
  const user = await requirePermission("patient:read");
  const { patientId } = await params;
  if (!UUID.test(patientId)) notFound();

  let detail;
  try {
    detail = await getPatientDetail(patientId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [doctors, branches, myBranchId] = await Promise.all([
    listDoctors(),
    listBranches(),
    getUserBranchId(user.id),
  ]);

  // Cross-branch access is the point of the shared history, so it is allowed —
  // and recorded. Metadata carries ids only.
  if (myBranchId !== detail.patient.branch_id) {
    await recordAudit({
      actorUserId: user.id,
      action: "PATIENT_HISTORY_VIEWED",
      entityType: "patient",
      entityId: detail.patient.id,
      metadata: { patient_branch_id: detail.patient.branch_id, viewer_branch_id: myBranchId },
    }).catch(() => undefined);
  }

  return (
    <div className="space-y-6">
      <PatientHeader detail={detail} role={user.role} doctors={doctors} />
      <PatientTabs
        detail={detail}
        role={user.role}
        branches={branches}
        myBranchId={myBranchId}
      />
    </div>
  );
}
