"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { setProcedureNumbering, type ProcedureNumbering } from "@/server/actions/branches";

const UNSET = "__unset__";

/** Per-procedure case-number prefix (RH-, LHR-…) and default delivery mode. */
export function ProcedureNumberingTab({ procedures }: { procedures: ProcedureNumbering[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, { prefix: string; mode: string }>>({});

  const save = (p: ProcedureNumbering) =>
    startTransition(async () => {
      const d = draft[p.id];
      const result = await setProcedureNumbering({
        procedureId: p.id,
        casePrefix: d?.prefix ?? p.case_prefix ?? "",
        defaultMode: (d?.mode ?? p.default_mode ?? UNSET) === UNSET ? null : ((d?.mode ?? p.default_mode) as "SURGICAL" | "SESSIONS"),
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(`${p.display_name}: new treatments numbered ${result.data.case_prefix ?? "TX-"}0001…`);
      setDraft(({ [p.id]: _drop, ...rest }) => {
        void _drop;
        return rest;
      });
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Treatment numbering</CardTitle>
        <CardDescription>
          Each treatment gets a case number from its procedure&apos;s prefix — RH-0001 for Rhinoplasty,
          LHR-0001 for Laser Hair Removal. Blank uses TX-. Existing case numbers never change.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Procedure</TableHead>
                <TableHead className="w-32">Prefix</TableHead>
                <TableHead className="w-44">Usually delivered as</TableHead>
                <TableHead className="w-24 text-right">
                  <span className="sr-only">Save</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {procedures.map((p) => {
                const d = draft[p.id];
                const prefix = d?.prefix ?? (p.case_prefix ?? "").replace(/-$/, "");
                const mode = d?.mode ?? p.default_mode ?? UNSET;
                const dirty = Boolean(d);
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      {p.display_name}
                      {!p.is_active ? <Badge variant="outline" className="ml-2">Inactive</Badge> : null}
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`${p.display_name} prefix`}
                        className="h-8 w-24 uppercase"
                        maxLength={6}
                        placeholder="TX"
                        value={prefix}
                        onChange={(e) => setDraft({ ...draft, [p.id]: { prefix: e.target.value, mode } })}
                      />
                    </TableCell>
                    <TableCell>
                      <Select value={mode} onValueChange={(value) => setDraft({ ...draft, [p.id]: { prefix, mode: value } })}>
                        <SelectTrigger className="h-8 w-40" aria-label={`${p.display_name} delivery`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNSET}>Not set</SelectItem>
                          <SelectItem value="SESSIONS">Sessions</SelectItem>
                          <SelectItem value="SURGICAL">Surgery</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={!dirty || pending} onClick={() => save(p)}>
                        Save
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
