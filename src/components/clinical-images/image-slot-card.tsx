"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import {
  CircleSlash,
  History,
  ImageOff,
  MoreVertical,
  RotateCcw,
  Upload,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { ImageAvailabilityBadge } from "@/components/app/status-badges";
import { ImageHistoryDialog } from "@/components/clinical-images/image-history-dialog";
import { MarkUnavailableDialog } from "@/components/clinical-images/mark-unavailable-dialog";
import { SecureImage } from "@/components/clinical-images/secure-image";
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
import { ALLOWED_IMAGE_MIME_TYPES, formatBytes } from "@/lib/images";
import { can } from "@/lib/permissions";
import { abandonUploadSession, uploadClinicalImage, UploadError } from "@/lib/upload-client";
import { clearSlotUnavailable } from "@/server/actions/images";
import type { ImageSlot, RoleCode } from "@/lib/types";

/**
 * One standard clinical view.
 *
 * Handles every state the slot can be in: empty, uploading, uploaded, and
 * explicitly not available. Replacing an image creates a new version and never
 * overwrites the stored original.
 */
export function ImageSlotCard({
  caseId,
  visitId,
  slot,
  role,
  maxImageBytes,
  readOnly,
  onChanged,
  onOpenViewer,
}: {
  caseId: string;
  visitId: string;
  slot: ImageSlot;
  role: RoleCode;
  maxImageBytes: number;
  readOnly: boolean;
  onChanged: () => void | Promise<void>;
  onOpenViewer: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<string | null>(null);

  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [clearing, startClear] = useTransition();

  const status = slot.image?.availability_status ?? "MISSING";
  const version = slot.currentVersion;

  const mayUpload = !readOnly && can(role, "image:upload");
  const mayMark = !readOnly && can(role, "image:mark_unavailable");
  const uploading = progress !== null;

  const handleFile = useCallback(
    async (file: File) => {
      setUploadError(null);
      setProgress(0);
      sessionRef.current = null;

      try {
        await uploadClinicalImage({
          file,
          target: { caseId, visitId, viewTypeId: slot.viewType.id },
          maxBytes: maxImageBytes,
          onProgress: (value) => setProgress(value.percent),
          onSession: (id) => {
            sessionRef.current = id;
          },
        });

        toast.success(
          version
            ? `${slot.viewType.display_name} replaced — the previous version is retained`
            : `${slot.viewType.display_name} uploaded`,
        );

        await onChanged();
      } catch (error) {
        const message =
          error instanceof UploadError
            ? error.message
            : "The image could not be uploaded. Please try again.";

        setUploadError(message);

        // Release the session so the object does not sit orphaned in storage.
        if (sessionRef.current) await abandonUploadSession(sessionRef.current);
      } finally {
        setProgress(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [caseId, visitId, slot.viewType.id, slot.viewType.display_name, maxImageBytes, onChanged, version],
  );

  return (
    <Card className="gap-3 overflow-hidden">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{slot.viewType.display_name}</CardTitle>

          {mayUpload || mayMark ? (
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

              <DropdownMenuContent align="end" className="w-52">
                {mayUpload ? (
                  <DropdownMenuItem onSelect={() => inputRef.current?.click()}>
                    <Upload aria-hidden />
                    {version ? "Replace image" : "Upload image"}
                  </DropdownMenuItem>
                ) : null}

                {slot.image ? (
                  <DropdownMenuItem onSelect={() => setShowHistory(true)}>
                    <History aria-hidden />
                    Version history
                  </DropdownMenuItem>
                ) : null}

                {mayMark ? (
                  <>
                    <DropdownMenuSeparator />
                    {status === "NOT_AVAILABLE" ? (
                      <DropdownMenuItem
                        disabled={clearing}
                        onSelect={() =>
                          startClear(async () => {
                            const result = await clearSlotUnavailable({
                              visitId,
                              viewTypeId: slot.viewType.id,
                            });

                            if (!result.ok) {
                              toast.error(result.error.message);
                              return;
                            }

                            toast.success("Marked as awaiting upload");
                            await onChanged();
                          })
                        }
                      >
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
              <UploadCloud className="text-muted-foreground mx-auto size-6 animate-pulse" aria-hidden />
              <Progress value={progress ?? 0} aria-label="Upload progress" />
              <p className="text-muted-foreground text-xs tabular-nums">{progress}%</p>
            </div>
          ) : version && slot.image ? (
            <SecureImage
              imageId={slot.image.id}
              alt={`${slot.viewType.display_name} clinical view`}
              onClick={onOpenViewer}
            />
          ) : status === "NOT_AVAILABLE" ? (
            <div className="text-muted-foreground space-y-1 p-4 text-center">
              <CircleSlash className="mx-auto size-6" aria-hidden />
              <p className="text-xs font-medium">Not available</p>
              {slot.image?.not_available_reason ? (
                <p className="text-xs">{slot.image.not_available_reason}</p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => mayUpload && inputRef.current?.click()}
              disabled={!mayUpload}
              className="text-muted-foreground hover:bg-muted/60 flex size-full cursor-pointer flex-col items-center justify-center gap-2 p-4 transition-colors disabled:cursor-default disabled:hover:bg-transparent"
            >
              <ImageOff className="size-6" aria-hidden />
              <span className="text-xs">
                {mayUpload ? "Upload image" : "No image uploaded"}
              </span>
            </button>
          )}
        </div>

        {uploadError ? (
          <p className="text-destructive mt-2 text-xs" role="alert">
            {uploadError}
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="flex-col items-start gap-1.5 px-3">
        <ImageAvailabilityBadge status={status} />

        {version ? (
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
          if (file) void handleFile(file);
        }}
      />

      <MarkUnavailableDialog
        open={showUnavailable}
        onOpenChange={setShowUnavailable}
        caseId={caseId}
        visitId={visitId}
        viewType={slot.viewType}
        onDone={onChanged}
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
