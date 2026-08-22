import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { requirePermission } from "@/server/auth/session";
import { pageMasterValues } from "@/server/services/master-data";
import { getUploadSessionStats } from "@/server/queries/uploads";
import type { MasterTable } from "@/lib/types";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS: { table: MasterTable; label: string; description: string }[] = [
  {
    table: "procedures",
    label: "Procedures",
    description: "Procedures offered. New values can also be created from the case form.",
  },
  {
    table: "procedure_types",
    label: "Procedure Types",
    description: "Primary, Revision and any additional types the clinic uses.",
  },
  {
    table: "complication_types",
    label: "Complication Types",
    description: "Reusable complication categories referenced from case notes.",
  },
  {
    table: "clinical_tags",
    label: "Tags",
    description: "Surgeon-defined tags for grouping and searching cases.",
  },
  {
    table: "followup_label_presets",
    label: "Follow-up Label Presets",
    description: "Suggested labels when a follow-up date is close to a standard interval.",
  },
];

export default async function SettingsPage() {
  await requirePermission("master_data:manage");

  const [sections, uploadStats] = await Promise.all([
    Promise.all(
      SECTIONS.map(async (section) => ({
        ...section,
        initial: await pageMasterValues({ table: section.table, includeInactive: true }),
      })),
    ),
    getUploadSessionStats(),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Reusable clinical values and the state of secure storage. Disabling a master value keeps it readable on historical cases but stops suggesting it for new ones — values are never deleted."
      />

      <SettingsTabs sections={sections} uploadStats={uploadStats} />
    </>
  );
}
