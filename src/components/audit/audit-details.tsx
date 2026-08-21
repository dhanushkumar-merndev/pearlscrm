"use client";

import { Badge } from "@/components/ui/badge";

/**
 * Renders audit metadata for display.
 *
 * Metadata is written to only ever hold changed field names and safe scalars.
 * This component additionally refuses to render anything that looks like a
 * secret or an internal identifier, so a future careless writer cannot leak
 * through the UI.
 */

const HIDDEN_KEYS = new Set([
  "secret",
  "token",
  "password",
  "key",
  "signature",
  "url",
  "object_key",
  "bucket",
]);

export function AuditDetails({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata ?? {}).filter(([key]) => !isHidden(key));

  if (entries.length === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  return (
    // Badges sit on one row while they fit the width the column is given, and
    // wrap onto a second row only when they genuinely do not. Forcing a single
    // line just trades a tall row for a horizontally scrolling table, which is
    // worse: the far-right details end up off screen entirely.
    <div className="flex flex-wrap items-center gap-1.5">
      {entries.map(([key, value]) => {
        const rendered = renderValue(key, value);
        if (rendered === null) return null;

        return (
          <Badge key={key} variant="outline" className="font-normal whitespace-nowrap">
            <span className="text-muted-foreground">{humanize(key)}:</span>
            <span className="ml-1 max-w-40 truncate">{rendered}</span>
          </Badge>
        );
      })}
    </div>
  );
}

function isHidden(key: string): boolean {
  const lower = key.toLowerCase();
  return [...HIDDEN_KEYS].some((hidden) => lower.includes(hidden));
}

function renderValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((item) => humanize(String(item))).join(", ");
  }

  if (typeof value === "object") {
    // A `{ from, to }` change pair, the common shape written by `diffForAudit`.
    const record = value as Record<string, unknown>;
    if ("from" in record || "to" in record) {
      return `${scalar(record.from)} → ${scalar(record.to)}`;
    }

    const inner = Object.entries(record)
      .filter(([innerKey]) => !isHidden(innerKey))
      .map(([innerKey, innerValue]) => `${humanize(innerKey)} ${scalar(innerValue)}`);

    return inner.length > 0 ? inner.join("; ") : null;
  }

  const text = String(value);

  // Bare UUIDs are internal identifiers with no meaning to a reader.
  if (isUuidLike(text)) return key.endsWith("_id") ? null : `${text.slice(0, 8)}…`;

  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  const text = String(value);
  if (isUuidLike(text)) return `${text.slice(0, 8)}…`;

  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function humanize(value: string): string {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatAuditAction(action: string): string {
  return humanize(action);
}
