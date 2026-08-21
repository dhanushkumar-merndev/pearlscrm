"use client";

import { useRef, useState } from "react";
import {
  CircleSlash,
  History,
  ImageOff,
  MoreVertical,
  RotateCcw,
  Trash2,
  Undo2,
  Upload,
  UploadCloud,
} from "lucide-react";

import { ImageAvailabilityBadge } from "@/components/app/status-badges";
import { ImageHistoryDialog } from "@/components/clinical-images/image-history-dialog";
import { MarkUnavailableDialog } from "@/components/clinical-images/mark-unavailable-dialog";
import { SecureImage } from "@/components/clinical-images/secure-image";
import {
  describeStaged,
  projectedStatus,
  type StagedChange,
} from "@/components/clinical-images/staged-changes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTimestamp } from "@/lib/dates";
import { ALLOWED_IMAGE_MIME_TYPES, formatBytes, validateUploadCandidate } from "@/lib/images";
import type { ImageSlot } from "@/lib/types";

/**
 * One standard clinical view.
 *
 * In editing mode the card only ever touches local state: a chosen file is held
 * in the browser and previewed from an object URL, and removals and
 * availability marks are recorded as intentions. Nothing is written until the
 * visit's Save applies the whole set.
 */
export function ImageSlotCard({
  slot,
  editing,
  staged,
  progress,
  maySelect,
  mayMark,
  maxImageBytes,
  onStage,
  onOpenViewer,
}: {
  slot: ImageSlot;
  editing: boolean;
  staged: StagedChange | undefined;
  /** 0–100 while this slot's staged file is uploading, otherwise null. */
  progress: number | null;
  maySelect: boolean;
  mayMark: boolean;
  maxImageBytes: number;
  onStage: (change: StagedChange | null) => void;
  onOpenViewer: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [showUnavailable, setShowUnavailable] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const saved = slot.image?.availability_status ?? "MISSING";
  const projected = projectedStatus(slot, staged);
  const version = slot.currentVersion;
  const uploading = progress !== null;

  const canChoose = editing && maySelect && !uploading;
  const showsSavedImage = version !== null && staged?.kind !== "upload" && staged?.kind !== "remove";

  return (
    <Card className="gap-3 overflow-hidden">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{slot.viewType.display_name}</CardTitle>

          {editing || slot.image ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mt-1 -mr-1 size-7"
                  aria-label={`${slot.viewType.display_name} actions`}
                  disabled={uploading}
                >
                  <MoreVertical aria-hidden />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-56">
                {canChoose ? (
                  <DropdownMenuItem onSelect={() => inputRef.current?.click()}>
                    <Upload aria-hidden />
                    {projected === "UPLOADED" ? "Choose a different image" : "Choose image"}
                  </DropdownMenuItem>
                ) : null}

                {canChoose && staged ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setFileError(null);
                      onStage(null);
                    }}
                  >
                    <Undo2 aria-hidden />
                    Undo pending change
                  </DropdownMenuItem>
                ) : null}

                {canChoose && version && staged?.kind !== "remove" ? (
                  <DropdownMenuItem variant="destructive" onSelect={() => onStage({ kind: "remove" })}>
                    <Trash2 aria-hidden />
                    Remove image
                  </DropdownMenuItem>
                ) : null}

                {slot.image ? (
                  <DropdownMenuItem onSelect={() => setShowHistory(true)}>
                    <History aria-hidden />
                    Version history
                  </DropdownMenuItem>
                ) : null}

                {editing && mayMark ? (
                  <>
                    <DropdownMenuSeparator />
                    {saved === "NOT_AVAILABLE" && staged?.kind !== "unavailable" ? (
                      <DropdownMenuItem onSelect={() => onStage({ kind: "clear-unavailable" })}>
                        <RotateCcw aria-hidden />
                        Clear &ldquo;not available&rdquo;
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => setShowUnavailable(true)}>
                        <CircleSlash aria-hidden />
                        Mark not available
                      </DropdownMenuItem>
                    )}
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="px-3">
        <div className="bg-muted/40 relative flex aspect-4/5 items-center justify-center overflow-hidden rounded-md border">
          {uploading ? (
            <div className="w-full space-y-2 p-4 text-center">
              <UploadCloud
                className="text-muted-foreground mx-auto size-6 animate-pulse"
                aria-hidden
              />
              <Progress value={progress ?? 0} aria-label="Upload progress" />
              <p className="text-muted-foreground text-xs tabular-nums">{progress}%</p>
            </div>
          ) : staged?.kind === "upload" ? (
            // Local preview only — these bytes have not left the browser yet.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={staged.previewUrl}
              alt={`${slot.viewType.display_name} clinical view, not yet saved`}
              className="size-full object-cover"
            />
          ) : showsSavedImage && slot.image ? (
            <SecureImage
              imageId={slot.image.id}
              alt={`${slot.viewType.display_name} clinical view`}
              onClick={onOpenViewer}
            />
          ) : projected === "NOT_AVAILABLE" ? (
            <div className="text-muted-foreground space-y-1 p-4 text-center">
              <CircleSlash className="mx-auto size-6" aria-hidden />
              <p className="text-xs font-medium">Not available</p>
              <p className="text-xs">
                {staged?.kind === "unavailable"
                  ? staged.reason
                  : (slot.image?.not_available_reason ?? "")}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => canChoose && inputRef.current?.click()}
              disabled={!canChoose}
              className="text-muted-foreground hover:bg-muted/60 flex size-full cursor-pointer flex-col items-center justify-center gap-2 p-4 transition-colors disabled:cursor-default disabled:hover:bg-transparent"
            >
              <ImageOff className="size-6" aria-hidden />
              <span className="text-xs">
                {canChoose ? "Choose image" : "No image uploaded"}
              </span>
            </button>
          )}
        </div>

        {fileError ? (
          <p className="text-destructive mt-2 text-xs" role="alert">
            {fileError}
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="flex-col items-start gap-1.5 px-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <ImageAvailabilityBadge status={projected} />
          {staged ? (
            <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
              Unsaved
            </Badge>
          ) : null}
        </div>

        {staged ? (
          <p className="text-muted-foreground text-xs">
            {staged.kind === "upload"
              ? `${staged.file.name} · ${formatBytes(staged.file.size)}`
              : describeStaged(staged)}
          </p>
        ) : version ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-muted-foreground cursor-help text-xs">
                {formatBytes(version.file_size)} · {formatTimestamp(version.uploaded_at)}
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              <p>Uploaded by {slot.uploadedByName ?? "an unknown user"}</p>
              <p>{version.mime_type}</p>
              {version.sha256 ? <p>SHA-256 recorded</p> : <p>No checksum recorded</p>}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </CardFooter>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;

          // Immediate feedback; the server repeats every one of these checks
          // before it signs an upload.
          const validation = validateUploadCandidate(
            file.name,
            file.type,
            file.size,
            maxImageBytes,
          );

          if (!validation.ok) {
            setFileError(validation.message);
            return;
          }

          setFileError(null);
          onStage({ kind: "upload", file, previewUrl: URL.createObjectURL(file) });
        }}
      />

      <MarkUnavailableDialog
        open={showUnavailable}
        onOpenChange={setShowUnavailable}
        viewType={slot.viewType}
        onConfirm={(reason) => onStage({ kind: "unavailable", reason })}
      />

      {slot.image ? (
        <ImageHistoryDialog
          open={showHistory}
          onOpenChange={setShowHistory}
          clinicalImageId={slot.image.id}
          viewName={slot.viewType.display_name}
        />
      ) : null}
    </Card>
  );
}
