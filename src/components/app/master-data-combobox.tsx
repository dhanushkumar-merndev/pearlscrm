"use client";

import { useCallback } from "react";

import { TypeOrCreateCombobox } from "@/components/app/type-or-create-combobox";
import { createMasterValueAction, searchMasterValuesAction } from "@/server/actions/master-data";
import type { MasterTable, MasterValue } from "@/lib/types";

/**
 * Binds `TypeOrCreateCombobox` to a specific master-data table.
 *
 * Both the search and the create call go through server actions, so creation
 * permission is enforced on the server — passing `canCreate` here only decides
 * whether the option is *offered*.
 */
export function MasterDataCombobox({
  table,
  canCreate = true,
  ...props
}: {
  table: MasterTable;
  label: string;
  value: string | null;
  onValueChange: (id: string | null, value: MasterValue | null) => void;
  selectedValue?: MasterValue | null;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  canCreate?: boolean;
}) {
  const searchAction = useCallback(
    async (query: string): Promise<MasterValue[]> => {
      const result = await searchMasterValuesAction({
        table,
        query,
        // Keeps an inactive value visible while editing a historical record.
        includeInactiveId: props.value ?? undefined,
      });

      if (!result.ok) throw new Error(result.error.message);
      return result.data.values;
    },
    [table, props.value],
  );

  const createAction = useCallback(
    async (displayName: string) => {
      const result = await createMasterValueAction({ table, displayName });

      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    [table],
  );

  return (
    <TypeOrCreateCombobox
      {...props}
      searchAction={searchAction}
      createAction={canCreate ? createAction : undefined}
    />
  );
}
