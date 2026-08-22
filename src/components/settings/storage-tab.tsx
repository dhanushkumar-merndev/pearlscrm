"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UploadMaintenance } from "@/components/settings/upload-maintenance";
import { updateStoragePlanAction } from "@/server/actions/storage";
import { useRealtime } from "@/hooks/use-realtime";
import { formatTimestamp } from "@/lib/dates";
import { formatCurrency, formatStorageBytes, percentOf } from "@/lib/storage";
import type { StorageUsage } from "@/server/queries/storage";
import type { UploadSessionStats } from "@/server/queries/uploads";

/**
 * Read-only view of the Tigris bucket.
 *
 * Every figure is measured by listing object storage itself, so it describes
 * what Tigris holds rather than what the database believes it holds. Where the
 * two disagree — an object nothing points at — that gap is shown, because it is
 * the gap an administrator can act on.
 *
 * Nothing on the reporting side can write. Reclaiming space is the separate,
 * explicit action below.
 */

const STORAGE_QUERY_KEY = ["storage-usage"] as const;

const SEGMENT_FILL: Record<string, string> = {
  current: "var(--chart-1)",
  superseded: "var(--chart-3)",
  avatars: "var(--chart-4)",
  orphaned: "var(--chart-5)",
  other: "var(--chart-2)",
};

const FREE_FILL = "var(--muted)";

async function fetchStorage(): Promise<StorageUsage> {
  const response = await fetch("/api/storage");
  if (!response.ok) throw new Error("Could not read secure storage.");
  return (await response.json()) as StorageUsage;
}

export function StorageTab({ uploadStats }: { uploadStats: UploadSessionStats }) {
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useQuery({
    queryKey: STORAGE_QUERY_KEY,
    queryFn: fetchStorage,
    // Measuring means walking the bucket, so this does not refetch on every
    // focus or remount. It is kept current by the realtime invalidation below,
    // which fires when an image actually lands, and by the explicit button.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Coalesced: saving a six-image phase fires six changes within a second, and
  // one re-measurement afterwards is enough.
  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void queryClient.invalidateQueries({ queryKey: STORAGE_QUERY_KEY });
    }, 600);
  }, [queryClient]);

  useRealtime({
    channel: "storage-usage",
    tables: [{ table: "clinical_images" }, { table: "cases" }],
    onChange: refresh,
  });

  return (
    <div className="space-y-4">
      {query.isPending && !query.data ? (
        <Skeleton className="h-96 w-full" />
      ) : query.data ? (
        <StorageContent
          usage={query.data}
          refreshing={query.isFetching}
          onRefresh={() => void queryClient.invalidateQueries({ queryKey: STORAGE_QUERY_KEY })}
        />
      ) : (
        <Alert variant="destructive">
          <AlertTitle>Secure storage could not be read</AlertTitle>
          <AlertDescription>
            The bucket did not respond. Check the Tigris credentials for this deployment, then try
            again.
          </AlertDescription>
        </Alert>
      )}

      <UploadMaintenance stats={uploadStats} onReconciled={refresh} />
    </div>
  );
}

function StorageContent({
  usage,
  refreshing,
  onRefresh,
}: {
  usage: StorageUsage;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const used = usage.totalBytes;
  const quota = usage.quotaBytes;
  const free = usage.availableBytes;
  const usedPercent = percentOf(used, quota);
  const overflowing = usage.billableBytes > 0;

  return (
    <div className="space-y-4">
      {usage.listingTruncated ? (
        <Alert>
          <AlertTitle>Showing part of the bucket</AlertTitle>
          <AlertDescription>
            The listing stopped at its object cap, so every total below is a lower bound.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Bucket contents</CardTitle>
            <CardDescription>
              {overflowing
                ? `${formatStorageBytes(usage.billableBytes)} over the ${formatStorageBytes(quota)} allowance.`
                : `${formatStorageBytes(free)} of ${formatStorageBytes(quota)} still available.`}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            <Donut
              segments={usage.segments.map((segment) => ({
                key: segment.key,
                value: segment.bytes,
                fill: SEGMENT_FILL[segment.key] ?? "var(--chart-2)",
              }))}
              free={free}
              total={Math.max(quota, used)}
              centerValue={formatStorageBytes(used)}
              centerLabel={`${usedPercent.toFixed(usedPercent < 10 ? 1 : 0)}% of ${formatStorageBytes(quota)}`}
            />

            <dl className="space-y-2.5">
              {usage.segments.map((segment) => (
                <div key={segment.key} className="flex items-start gap-2.5">
                  <span
                    className="mt-1.5 size-2.5 shrink-0 rounded-[2px]"
                    style={{ background: SEGMENT_FILL[segment.key] ?? "var(--chart-2)" }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <dt className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{segment.label}</span>
                      <span className="shrink-0 tabular-nums">
                        {formatStorageBytes(segment.bytes)}
                      </span>
                    </dt>
                    <dd className="text-muted-foreground text-xs">
                      {segment.objects} {segment.objects === 1 ? "object" : "objects"} ·{" "}
                      {segment.description}
                    </dd>
                  </div>
                </div>
              ))}

              <div className="border-border flex items-start gap-2.5 border-t pt-2.5">
                <span
                  className="border-border mt-1.5 size-2.5 shrink-0 rounded-[2px] border"
                  style={{ background: FREE_FILL }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <dt className="flex items-baseline justify-between gap-2 text-sm">
                    <span>{overflowing ? "Over allowance" : "Available"}</span>
                    <span
                      className={`shrink-0 tabular-nums ${overflowing ? "text-destructive font-medium" : ""}`}
                    >
                      {overflowing
                        ? `+${formatStorageBytes(usage.billableBytes)}`
                        : formatStorageBytes(free)}
                    </span>
                  </dt>
                  <dd className="text-muted-foreground text-xs">
                    {overflowing
                      ? "Billed at the rate below."
                      : `Included in the ${formatStorageBytes(quota)} allowance.`}
                  </dd>
                </div>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <BucketCard usage={usage} refreshing={refreshing} onRefresh={onRefresh} />
          <CasesCard usage={usage} />
        </div>
      </div>
    </div>
  );
}

/**
 * Bucket metadata, and the plan it is measured against.
 *
 * The top table is measured from Tigris. The plan below it is not measurable —
 * Tigris publishes no plan or billing endpoint on its S3-compatible API — so it
 * is recorded here, seeded with Tigris's published free tier, and the cost is
 * an estimate on the overflow rather than a reproduction of an invoice. The
 * console link is there because the console is the authority.
 */
function BucketCard({
  usage,
  refreshing,
  onRefresh,
}: {
  usage: StorageUsage;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const rows: { label: string; value: React.ReactNode; strong?: boolean }[] = [
    { label: "Bucket", value: usage.bucket },
    { label: "Region", value: usage.region },
    { label: "Access", value: "Private \u00b7 presigned URLs only" },
    { label: "Objects", value: usage.totalObjects.toLocaleString() },
    { label: "Total size", value: formatStorageBytes(usage.totalBytes) },
    { label: "Largest object", value: formatStorageBytes(usage.largestObjectBytes) },
    {
      label: "Most recent upload",
      value: usage.newestObjectAt ? formatTimestamp(usage.newestObjectAt) : "\u2014",
    },
    {
      label: "Oldest object",
      value: usage.oldestObjectAt ? formatTimestamp(usage.oldestObjectAt) : "\u2014",
    },
    { label: "Included in plan", value: formatStorageBytes(usage.includedBytes) },
    {
      label: "Over allowance",
      value:
        usage.billableBytes > 0 ? (
          <span className="text-destructive">+{formatStorageBytes(usage.billableBytes)}</span>
        ) : (
          formatStorageBytes(0)
        ),
    },
    {
      label: "Estimated storage cost",
      value:
        usage.billableBytes > 0
          ? `${formatCurrency(usage.estimatedMonthlyCost, usage.currency)} / month`
          : `${formatCurrency(0, usage.currency)} \u00b7 within allowance`,
      strong: true,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tigris bucket</CardTitle>
        <CardDescription>
          Read directly from object storage.
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <a href={usage.consoleUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              Tigris console
            </a>
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className={row.strong ? "font-medium" : undefined}>
                    {row.label}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${row.strong ? "font-medium" : ""}`}
                  >
                    {row.value}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            Storage only \u2014 request and bandwidth charges are not modelled. Measured{" "}
            {formatTimestamp(usage.measuredAt)}.
          </p>

          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Spinner /> : <RefreshCw aria-hidden />}
            Re-measure
          </Button>
        </div>

        <PlanEditor usage={usage} />
      </CardContent>
    </Card>
  );
}

/**
 * The allowance and rate the figures above are measured against.
 *
 * Seeded from Tigris's published free tier so the screen shows an Available
 * figure out of the box, and editable because a vendor's pricing is not
 * something this application can keep guaranteed-current.
 */
function PlanEditor({ usage }: { usage: StorageUsage }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [quotaGb, setQuotaGb] = useState(() =>
    String(Number((usage.quotaBytes / 1024 ** 3).toFixed(3))),
  );
  const [rate, setRate] = useState(String(usage.costPerGbMonth));
  const [currency, setCurrency] = useState(usage.currency);

  const save = () => {
    startTransition(async () => {
      const result = await updateStoragePlanAction({
        quotaGb,
        costPerGbMonth: rate,
        currency,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      toast.success("Storage plan updated");
      setOpen(false);
    });
  };

  return (
    <div className="bg-muted/40 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            Plan: {formatStorageBytes(usage.quotaBytes)} included,{" "}
            {formatCurrency(usage.costPerGbMonth, usage.currency)} / GB / month after
          </p>
          <p className="text-muted-foreground text-xs">
            {usage.planSource === "configured"
              ? `Set by an administrator${usage.planUpdatedAt ? ` on ${formatTimestamp(usage.planUpdatedAt)}` : ""}.`
              : usage.planSource === "environment"
                ? "From this deployment\u2019s environment configuration."
                : "Tigris\u2019s published free tier. Check your console and adjust if your plan differs."}
          </p>
        </div>

        <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>
          {open ? "Cancel" : "Edit plan"}
        </Button>
      </div>

      {open ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_6rem_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="storage-quota">Allowance (GB)</Label>
            <Input
              id="storage-quota"
              inputMode="decimal"
              value={quotaGb}
              onChange={(event) => setQuotaGb(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="storage-rate">Rate per GB / month</Label>
            <Input
              id="storage-rate"
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="storage-currency">Currency</Label>
            <Input
              id="storage-currency"
              maxLength={3}
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </div>

          <Button onClick={save} disabled={pending}>
            {pending ? <Spinner /> : null}
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CasesCard({ usage }: { usage: StorageUsage }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? usage.cases : usage.cases.slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle>By case</CardTitle>
        <CardDescription>
          Stored objects grouped by the case in their key. Includes replaced originals, which are
          retained.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {usage.cases.length === 0 ? (
          <p className="text-muted-foreground text-sm">No clinical images stored yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Case</TableHead>
                    <TableHead className="text-right">Objects</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Last upload</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.caseId}>
                      <TableCell className="font-medium tabular-nums">{row.caseNumber}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.images}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatStorageBytes(row.bytes)}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-right text-sm tabular-nums sm:table-cell">
                        {row.lastUploadedAt ? formatTimestamp(row.lastUploadedAt) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              {usage.cases.length > 8 ? (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? "Show top 8" : `Show all ${usage.cases.length} cases`}
                </button>
              ) : (
                <span />
              )}

              {usage.casesTruncated ? (
                <p className="text-muted-foreground text-xs">
                  Showing the {usage.cases.length} largest cases. Bucket totals cover every object.
                </p>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type DonutSegment = { key: string; value: number; fill: string };

/**
 * Inline SVG rather than a charting library.
 *
 * One ring of five arcs does not justify a dependency, and this page is served
 * from a Worker where every kilobyte of bundle is CPU somebody pays for. Each
 * figure is also rendered as text beside the ring, so nothing here is available
 * only as colour.
 */
function Donut({
  segments,
  free,
  total,
  centerValue,
  centerLabel,
}: {
  segments: DonutSegment[];
  free: number;
  total: number;
  centerValue: string;
  centerLabel: string;
}) {
  const RADIUS = 60;
  const STROKE = 18;
  const circumference = 2 * Math.PI * RADIUS;

  const arcs = useMemo(() => {
    const parts = [
      ...segments.filter((segment) => segment.value > 0),
      ...(free > 0 ? [{ key: "free", value: free, fill: FREE_FILL }] : []),
    ];

    const sum = total > 0 ? total : parts.reduce((acc, part) => acc + part.value, 0);
    if (sum <= 0) return [];

    let offset = 0;

    return parts.map((part) => {
      const fraction = part.value / sum;
      const arc = {
        ...part,
        dash: fraction * circumference,
        offset: -offset * circumference,
      };
      offset += fraction;
      return arc;
    });
  }, [segments, free, total, circumference]);

  return (
    <div className="flex justify-center">
      <svg
        viewBox="0 0 160 160"
        className="h-44 w-44"
        role="img"
        aria-label={`${centerValue} stored, ${centerLabel}`}
      >
        <circle cx="80" cy="80" r={RADIUS} fill="none" stroke="var(--muted)" strokeWidth={STROKE} />

        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx="80"
            cy="80"
            r={RADIUS}
            fill="none"
            stroke={arc.fill}
            strokeWidth={STROKE}
            strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
            strokeDashoffset={arc.offset}
            transform="rotate(-90 80 80)"
          />
        ))}

        <text
          x="80"
          y="76"
          textAnchor="middle"
          className="fill-foreground text-[17px] font-semibold tabular-nums"
        >
          {centerValue}
        </text>
        <text x="80" y="94" textAnchor="middle" className="fill-muted-foreground text-[10px]">
          {centerLabel}
        </text>
      </svg>
    </div>
  );
}
