"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { CLINICAL_CACHE_TIME_MS } from "@/lib/query-client";
import { cn } from "@/lib/utils";

type SignedImageUrl = { url: string; expiresInSeconds: number };

/**
 * Renders a private clinical image through a short-lived presigned URL.
 *
 * The URL is fetched from an authorized endpoint and cached only in this
 * signed-in browser session—never persisted and never public. It is refreshed
 * shortly before expiry so a long-open tab does not show broken images.
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
  const [visible, setVisible] = useState(
    () => eager || typeof IntersectionObserver === "undefined",
  );
  const signedUrl = useQuery({
    queryKey: ["clinical-image-url", imageId, versionId ?? null] as const,
    queryFn: async (): Promise<SignedImageUrl> => {
      const search = versionId ? `?versionId=${encodeURIComponent(versionId)}` : "";
      const response = await fetch(`/api/images/${imageId}/url${search}`);
      if (!response.ok) throw new Error("The image could not be loaded.");
      return (await response.json()) as SignedImageUrl;
    },
    enabled: visible,
    // URLs are short-lived. Keep the query in memory for an hour, but make it
    // stale and re-sign it one minute before the current URL expires.
    staleTime: (query) => {
      const seconds = query.state.data?.expiresInSeconds ?? 90;
      return Math.max(30, seconds - 60) * 1000;
    },
    gcTime: CLINICAL_CACHE_TIME_MS,
    refetchInterval: (query) => {
      const seconds = query.state.data?.expiresInSeconds;
      return seconds ? Math.max(30, seconds - 60) * 1000 : false;
    },
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (eager || visible) return;

    const element = containerRef.current;
    if (!element) return;

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

  if (signedUrl.isError) {
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

  if (!signedUrl.data) {
    return <Skeleton ref={containerRef} className="size-full" />;
  }

  const image = (
    // A presigned URL is single-use-ish and short-lived, so Next's image
    // optimizer would only cache something that is about to expire.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={signedUrl.data.url}
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
