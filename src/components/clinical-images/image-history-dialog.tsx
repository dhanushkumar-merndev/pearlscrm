"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestamp } from "@/lib/dates";
import { formatBytes } from "@/lib/images";
import { getImageHistory, type ImageHistoryEntry } from "@/server/actions/image-slots";

/**
 * Replacement history for one image slot.
 *
 * Superseded versions are retained forever — the original object is never
 * overwritten or deleted, only marked as no longer current.
 */
export function ImageHistoryDialog({
  open,
  onOpenChange,
  clinicalImageId,
  viewName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clinicalImageId: string;
  viewName: string;
}) {
  const [entries, setEntries] = useState<ImageHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (next) {
      // Reset before a fresh fetch instead of doing it inside the effect.
      setEntries(null);
      setError(null);
    }
  };

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    void getImageHistory({ clinicalImageId }).then((result) => {
      if (cancelled) return;
      if (!result.ok) setError(result.error.message);
      else setEntries(result.data);
    });

    return () => {
      cancelled = true;
    };
  }, [open, clinicalImageId]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{viewName} — version history</DialogTitle>
          <DialogDescription>
            Every upload is retained. Replacing an image stores a new object and marks the previous
            one superseded; nothing is overwritten.
          </DialogDescription>
        </DialogHeader>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        {entries === null && !error ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : null}

        {entries ? (
          <ScrollArea className="max-h-80">
            <ol className="space-y-3 pr-3">
              {entries.map((entry, index) => (
                <li key={entry.id} className="space-y-1 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      Version {entries.length - index}
                    </span>
                    {entry.superseded_at ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Superseded
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Current</Badge>
                    )}
                  </div>

                  <dl className="text-muted-foreground space-y-0.5 text-xs">
                    <div>Uploaded {formatTimestamp(entry.uploaded_at)}</div>
                    <div>By {entry.uploaded_by_name ?? "an unknown user"}</div>
                    <div>
                      {entry.mime_type} · {formatBytes(entry.file_size)}
                    </div>
                    {entry.original_filename ? (
                      <div className="truncate">Original filename: {entry.original_filename}</div>
                    ) : null}
                    {entry.sha256 ? (
                      <div className="font-mono break-all">SHA-256 {entry.sha256.slice(0, 32)}…</div>
                    ) : (
                      <div>No checksum recorded</div>
                    )}
                    {entry.superseded_at ? (
                      <div>Superseded {formatTimestamp(entry.superseded_at)}</div>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ol>
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
