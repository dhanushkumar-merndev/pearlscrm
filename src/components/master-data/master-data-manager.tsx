"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatClinicDate } from "@/lib/dates";
import { normalizeMasterKey } from "@/lib/master-data";
import {
  createMasterValueAction,
  setMasterValueActiveAction,
} from "@/server/actions/master-data";
import type { MasterTable, MasterValue } from "@/lib/types";

type Section = {
  table: MasterTable;
  label: string;
  description: string;
  values: MasterValue[];
};

export function MasterDataManager({ sections }: { sections: Section[] }) {
  return (
    <Tabs defaultValue={sections[0]?.table} className="gap-6">
      <div className="overflow-x-auto">
        <TabsList>
          {sections.map((section) => (
            <TabsTrigger key={section.table} value={section.table}>
              {section.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {sections.map((section) => (
        <TabsContent key={section.table} value={section.table}>
          <MasterDataSection section={section} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function MasterDataSection({ section }: { section: Section }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [newValue, setNewValue] = useState("");

  const filtered = useMemo(() => {
    const key = normalizeMasterKey(search);
    if (!key) return section.values;
    return section.values.filter((value) => value.normalized_key.includes(key));
  }, [section.values, search]);

  const duplicate = useMemo(() => {
    const key = normalizeMasterKey(newValue);
    return key ? section.values.some((value) => value.normalized_key === key) : false;
  }, [section.values, newValue]);

  const create = () => {
    startTransition(async () => {
      const result = await createMasterValueAction({
        table: section.table,
        displayName: newValue,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success(
        result.data.created
          ? `Added “${result.data.value.display_name}”`
          : `“${result.data.value.display_name}” already existed`,
      );
      setNewValue("");
      router.refresh();
    });
  };

  const toggle = (value: MasterValue, isActive: boolean) => {
    startTransition(async () => {
      const result = await setMasterValueActiveAction({
        table: section.table,
        id: value.id,
        isActive,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success(isActive ? "Value enabled" : "Value disabled");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.label}</CardTitle>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`search-${section.table}`}>Search</Label>
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden
              />
              <Input
                id={`search-${section.table}`}
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${section.label.toLowerCase()}`}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`add-${section.table}`}>Add a value</Label>
            <div className="flex gap-2">
              <Input
                id={`add-${section.table}`}
                value={newValue}
                onChange={(event) => setNewValue(event.target.value)}
                placeholder="New value"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && newValue.trim() && !duplicate) {
                    event.preventDefault();
                    create();
                  }
                }}
              />
              <Button onClick={create} disabled={pending || !newValue.trim() || duplicate}>
                {pending ? <Spinner /> : <Plus aria-hidden />}
                Add
              </Button>
            </div>
            {duplicate ? (
              <p className="text-muted-foreground text-xs">That value already exists.</p>
            ) : null}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {search ? "No values match your search." : "No values yet."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Value</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  <TableHead className="hidden md:table-cell">Usage</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filtered.map((value) => (
                  <TableRow key={value.id}>
                    <TableCell className="font-medium">
                      {value.display_name}
                      {!value.is_active ? (
                        <Badge variant="outline" className="text-muted-foreground ml-2">
                          Inactive
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">
                      {formatClinicDate(value.created_at.slice(0, 10))}
                    </TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">
                      {value.usage_count}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={value.is_active}
                        disabled={pending}
                        aria-label={`${value.display_name} active`}
                        onCheckedChange={(checked) => toggle(value, checked)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          Values in use cannot be deleted. Disabling one stops it appearing in dropdowns for new
          records while keeping historical cases readable.
        </p>
      </CardContent>
    </Card>
  );
}
