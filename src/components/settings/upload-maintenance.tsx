"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { formatTimestamp } from "@/lib/dates";
import { sweepUploadSessionsAction } from "@/server/actions/images";
import type { UploadSessionStats } from "@/server/queries/uploads";

/**
 * Administrative control for orphaned upload objects.
 *
 * The sweep is deliberately manual rather than automatic-on-a-timer: it deletes
 * objects from storage, and an administrator should be the one to decide when
 * that happens. Recovery of a lost image needs no button — it happens whenever
 * somebody opens the case.
 */
export function UploadMaintenance({
  stats,
  onReconciled,
}: {
  stats: UploadSessionStats;
  /** Lets the caller re-measure storage once objects have been reclaimed. */
  onReconciled?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastRun, setLastRun] = useState<string | null>(null);

  const sweep = () => {
    startTransition(async () => {
      const result = await sweepUploadSessionsAction();

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      const { scanned, recovered, released } = result.data;
      setLastRun(
        `Checked ${scanned} ${scanned === 1 ? "upload" : "uploads"} — ` +
          `${recovered} recovered onto empty slots, ${released} released from storage.`,
      );
      toast.success(
        recovered > 0
          ? `Recovered ${recovered} ${recovered === 1 ? "image" : "images"}.`
          : "Nothing left to reclaim.",
      );
      onReconciled?.();
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unfinalized uploads</CardTitle>
        <CardDescription>
          Image bytes go straight to secure storage, and the record of them is written immediately
          afterwards. If that second step is lost — a closed tab, a dropped connection — the object
          is left with nothing pointing at it. Opening the case recovers it automatically; this
          sweep covers everything nobody has opened.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Recorded" value={stats.finalized} />
          <Stat label="Awaiting record" value={stats.stale} />
          <Stat label="In flight" value={stats.pending - stats.stale} />
          <Stat label="Released" value={stats.abandoned} />
        </dl>

        {stats.stale > 0 ? (
          <Alert>
            <AlertTitle>
              {stats.stale} {stats.stale === 1 ? "upload has" : "uploads have"} not been recorded
            </AlertTitle>
            <AlertDescription>
              {stats.oldestStaleAt
                ? `The oldest was authorized on ${formatTimestamp(stats.oldestStaleAt)}. `
                : ""}
              Any whose image slot is still empty will be recorded against the case. The rest are
              superseded copies and their objects are deleted. Originals already on record are never
              touched.
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-muted-foreground text-sm">
            Every completed upload is recorded against its case. Nothing to reclaim.
          </p>
        )}

        {lastRun ? <p className="text-muted-foreground text-sm">{lastRun}</p> : null}
      </CardContent>

      <CardFooter>
        <Button onClick={sweep} disabled={pending}>
          {pending ? <Spinner /> : <RefreshCw aria-hidden />}
          Reconcile now
        </Button>
      </CardFooter>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{Math.max(0, value)}</dd>
    </div>
  );
}
