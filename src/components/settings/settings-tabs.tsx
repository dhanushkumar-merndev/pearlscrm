"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MasterDataSection, type Section } from "@/components/master-data/master-data-manager";
import { StorageTab } from "@/components/settings/storage-tab";
import type { UploadSessionStats } from "@/server/queries/uploads";

/**
 * One tab strip for every administrative setting.
 *
 * Storage sits alongside the master-data tables rather than on a route of its
 * own: it is a setting an administrator checks in passing, not a destination,
 * and a second Settings entry in the sidebar would suggest otherwise.
 */
export function SettingsTabs({
  sections,
  uploadStats,
}: {
  sections: Section[];
  uploadStats: UploadSessionStats;
}) {
  return (
    <Tabs defaultValue={sections[0]?.table ?? "storage"} className="gap-6">
      <div className="overflow-x-auto overflow-y-hidden">
        <TabsList>
          {sections.map((section) => (
            <TabsTrigger key={section.table} value={section.table}>
              {section.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="storage">Storage</TabsTrigger>
        </TabsList>
      </div>

      {sections.map((section) => (
        <TabsContent key={section.table} value={section.table}>
          <MasterDataSection section={section} />
        </TabsContent>
      ))}

      <TabsContent value="storage">
        <StorageTab uploadStats={uploadStats} />
      </TabsContent>
    </Tabs>
  );
}
