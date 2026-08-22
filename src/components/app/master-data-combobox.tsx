"use client";

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { TypeOrCreateCombobox } from "@/components/app/type-or-create-combobox";
import { CLINICAL_CACHE_TIME_MS } from "@/lib/query-client";
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
  const queryClient = useQueryClient();
  const defaultOptionsKey = useMemo(
    () => ["master-data-options", table, props.value ?? "active"] as const,
    [table, props.value],
  );

  const searchAction = useCallback(
    async (query: string): Promise<MasterValue[]> => {
      const load = async () => {
        const result = await searchMasterValuesAction({
          table,
          query,
          // Keeps an inactive value visible while editing a historical record.
          includeInactiveId: props.value ?? undefined,
        });

        if (!result.ok) throw new Error(result.error.message);

        // The server separately verifies the exact normalized match, so it
        // remains selectable even if a future ranking rule puts it past limit.
        const exact = result.data.exactMatch;
        return exact && !result.data.values.some((value) => value.id === exact.id)
          ? [exact, ...result.data.values]
          : result.data.values;
      };

      // Opening a picker shows the same limited default list every time. Cache
      // it for the active browser session; it is still cleared on hard refresh
      // and when the signed-in user changes. Typed searches deliberately stay
      // uncached so each term is checked against current master data.
      if (!query.trim()) {
        return queryClient.fetchQuery({
          queryKey: defaultOptionsKey,
          queryFn: load,
          staleTime: CLINICAL_CACHE_TIME_MS,
        });
      }

      return load();
    },
    [defaultOptionsKey, queryClient, table, props.value],
  );

  const createAction = useCallback(
    async (displayName: string) => {
      const result = await createMasterValueAction({ table, displayName });

      if (!result.ok) throw new Error(result.error.message);

      // Keep existing open/default pickers in sync without throwing away their
      // one-hour cache. Search terms are not cached and naturally see it too.
      if (result.data.value.is_active) {
        queryClient.setQueriesData<MasterValue[]>(
          { queryKey: ["master-data-options", table] },
          (current) => {
            if (!current || current.some((value) => value.id === result.data.value.id)) return current;
            return [result.data.value, ...current];
          },
        );
      }

      return result.data;
    },
    [queryClient, table],
  );

  return (
    <TypeOrCreateCombobox
      {...props}
      searchAction={searchAction}
      createAction={canCreate ? createAction : undefined}
    />
  );
}
