import { Skeleton } from "@/components/ui/skeleton";

type Variant = "table" | "detail" | "form" | "dashboard";

/**
 * Route-level loading placeholder. Rendered by `loading.tsx` so a navigation
 * paints immediately (and prefetching can cache the shell) while the server
 * fetches the page's data. Shapes only — never fake records.
 */
export function PageSkeleton({ variant = "table" }: { variant?: Variant }) {
  return (
    <div className="space-y-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        {variant !== "form" ? <Skeleton className="h-9 w-32" /> : null}
      </div>

      {variant === "dashboard" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </>
      ) : null}

      {variant === "table" ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-64 max-w-full" />
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-32" />
          </div>
          <div className="space-y-2 rounded-md border p-3">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        </>
      ) : null}

      {variant === "detail" ? (
        <>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-24" />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        </>
      ) : null}

      {variant === "form" ? (
        <div className="max-w-2xl space-y-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
