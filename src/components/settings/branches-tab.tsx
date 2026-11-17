"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createBranch, updateBranch } from "@/server/actions/branches";
import type { Branch } from "@/lib/types";

/** Branches and their File ID codes. Never deleted; a used code is frozen. */
export function BranchesTab({ branches }: { branches: Branch[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [edits, setEdits] = useState<Record<string, { code: string; name: string }>>({});

  const add = () =>
    startTransition(async () => {
      const result = await createBranch({ code, name });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(`Branch ${result.data.code} added. Its first File ID will be ${result.data.code}0001.`);
      setCode("");
      setName("");
      router.refresh();
    });

  const save = (branch: Branch, patch: Partial<{ code: string; name: string; isActive: boolean }>) =>
    startTransition(async () => {
      const edit = edits[branch.id];
      const result = await updateBranch({
        branchId: branch.id,
        code: patch.code ?? edit?.code ?? branch.code,
        name: patch.name ?? edit?.name ?? branch.name,
        isActive: patch.isActive ?? branch.is_active,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(`${result.data.code} saved`);
      setEdits(({ [branch.id]: _drop, ...rest }) => {
        void _drop;
        return rest;
      });
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branches</CardTitle>
        <CardDescription>
          Each branch numbers its own patients: BG0001, KL0001, SH0001… Disabling a branch stops new
          registrations there; existing File IDs keep working.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-28">Active</TableHead>
                <TableHead className="w-24 text-right">
                  <span className="sr-only">Save</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.map((branch) => {
                const edit = edits[branch.id];
                const dirty = edit && (edit.code !== branch.code || edit.name !== branch.name);
                return (
                  <TableRow key={branch.id}>
                    <TableCell>
                      <Input
                        aria-label={`${branch.name} code`}
                        className="h-8 w-20 uppercase"
                        maxLength={4}
                        value={edit?.code ?? branch.code}
                        onChange={(e) => setEdits({ ...edits, [branch.id]: { code: e.target.value, name: edit?.name ?? branch.name } })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`${branch.code} name`}
                        className="h-8"
                        value={edit?.name ?? branch.name}
                        onChange={(e) => setEdits({ ...edits, [branch.id]: { code: edit?.code ?? branch.code, name: e.target.value } })}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={branch.is_active}
                          disabled={pending}
                          onCheckedChange={(checked) => save(branch, { isActive: checked })}
                          aria-label={`${branch.code} active`}
                        />
                        {!branch.is_active ? <Badge variant="outline">Off</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={!dirty || pending} onClick={() => save(branch, {})}>
                        Save
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="new-branch-code">Code</Label>
            <Input id="new-branch-code" className="w-24 uppercase" maxLength={4} placeholder="JN" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="new-branch-name">Name</Label>
            <Input id="new-branch-name" placeholder="Jayanagar" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button onClick={add} disabled={pending || !code.trim() || !name.trim()}>
            {pending ? <Spinner /> : <Plus aria-hidden />}
            Add branch
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
