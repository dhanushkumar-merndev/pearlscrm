import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { MasterDataManager } from "@/components/master-data/master-data-manager";
import { requirePermission } from "@/server/auth/session";
import { listMasterValues } from "@/server/services/master-data";
import type { MasterTable, MasterValue } from "@/lib/types";

export const metadata: Metadata = { title: "Clinical Master Data" };

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

export default async function MasterDataPage() {
  await requirePermission("master_data:manage");

  const sections = await Promise.all(
    SECTIONS.map(async (section) => ({
      ...section,
      values: await listMasterValues({ table: section.table, includeInactive: true }),
    })),
  );

  return (
    <>
      <PageHeader
        title="Clinical Master Data"
        description="Reusable clinical values. Disabling a value keeps it readable on historical cases but stops suggesting it for new ones — values are never deleted."
      />

      <MasterDataManager
        sections={sections as { table: MasterTable; label: string; description: string; values: MasterValue[] }[]}
      />
    </>
  );
}
