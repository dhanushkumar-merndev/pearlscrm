"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { Branch } from "@/lib/types";

const ALL = "__all__";

/** URL-driven search + branch filter. The query runs in Postgres, one page at a time. */
export function PatientsSearch({ branches }: { branches: Branch[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const debounced = useDebouncedValue(q.trim(), 300);

  const navigate = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if ((searchParams.get("q") ?? "") === debounced) return;
    navigate({ q: debounced || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the debounced text drives navigation
  }, [debounced]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <InputGroup className="sm:max-w-md">
        <InputGroupAddon>
          <Search aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search patients"
          placeholder="File ID (KL12), name or phone"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </InputGroup>
      <Select
        value={searchParams.get("branchId") ?? ALL}
        onValueChange={(value) => navigate({ branchId: value === ALL ? undefined : value })}
      >
        <SelectTrigger className="sm:w-56" aria-label="Branch">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All branches</SelectItem>
          {branches.map((branch) => (
            <SelectItem key={branch.id} value={branch.id}>
              {branch.code} · {branch.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
