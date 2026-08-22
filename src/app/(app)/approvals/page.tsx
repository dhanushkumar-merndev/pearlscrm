import type { Metadata } from "next";
import { z } from "zod";

import { PageHeader } from "@/components/app/page-header";
import { ApprovalsPanel } from "@/components/approvals/approvals-panel";
import { requirePermission } from "@/server/auth/session";
import { listChanges } from "@/server/queries/changes";
import {
  listDecidedEditRequests,
  listPendingEditRequests,
} from "@/server/queries/notifications";

export const metadata: Metadata = { title: "Edit Approvals" };

/** Each list paginates independently, so they carry separate page params. */
const pageNumber = z.coerce.number().int().min(1).catch(1);

export default async function ApprovalsPage({ searchParams }: PageProps<"/approvals">) {
  await requirePermission("edit_request:decide");

  const params = await searchParams;

  const [pending, decided, changes] = await Promise.all([
    listPendingEditRequests(pageNumber.parse(params.pendingPage)),
    listDecidedEditRequests(pageNumber.parse(params.decidedPage)),
    listChanges({ page: pageNumber.parse(params.changesPage) }),
  ]);

  return (
    <>
      <PageHeader
        title="Edit Approvals"
        description="Submitted case information, image sets and follow-ups are locked. Approving a request grants the requester one editing pass; saving their changes closes it again."
      />

      <ApprovalsPanel pending={pending} decided={decided} changes={changes} />
    </>
  );
}
