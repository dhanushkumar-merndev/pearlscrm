"use client";

import { useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Renders a private clinical image through a short-lived presigned URL.
 *
 * The URL is fetched per render from an authorized endpoint, never persisted,
 * and never a permanent public link. It is also refreshed shortly before it
 * expires so a long-open tab does not start showing broken images.
 *
 * Loading is deferred until the element is near the viewport, so switching to a
 * follow-up tab does not pull six full-resolution originals at once.
 */
export function SecureImage({
  imageId,
  versionId,
  alt,
  className,
  onClick,
  eager = false,
}: {
  imageId: string;
  versionId?: string;
  alt: string;
  className?: string;
  onClick?: () => void;
  eager?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (eager || visible) return;

    const element = containerRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [eager, visible]);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      setFailed(false);

      try {
        const search = versionId ? `?versionId=${encodeURIComponent(versionId)}` : "";
        const response = await fetch(`/api/images/${imageId}/url${search}`);

        if (!response.ok) throw new Error("denied");

        const body = (await response.json()) as { url: string; expiresInSeconds: number };
        if (cancelled) return;

        setUrl(body.url);

        // Re-sign a minute before expiry so the image never goes stale on screen.
        const refreshIn = Math.max(30, body.expiresInSeconds - 60) * 1000;
        refreshTimer = setTimeout(() => void load(), refreshIn);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [imageId, versionId, visible]);

  if (failed) {
    return (
      <div
        ref={containerRef}
        className="text-muted-foreground flex size-full flex-col items-center justify-center gap-2 p-4 text-center"
      >
        <ImageOff className="size-6" aria-hidden />
        <p className="text-xs">This image could not be loaded.</p>
      </div>
    );
  }

  if (!url) {
    return <Skeleton ref={containerRef} className="size-full" />;
  }

  const image = (
    // A presigned URL is single-use-ish and short-lived, so Next's image
    // optimizer would only cache something that is about to expire.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn("size-full object-cover", className)}
    />
  );

  return (
    <div ref={containerRef} className="size-full">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="focus-visible:ring-ring size-full cursor-zoom-in focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`View ${alt} full size`}
        >
          {image}
        </button>
      ) : (
        image
      )}
    </div>
  );
}
