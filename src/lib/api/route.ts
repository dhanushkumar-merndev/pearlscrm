import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AppError, errorStatus, newCorrelationId, logServerError } from "@/lib/errors";

/**
 * Shared route-handler wrapper.
 *
 * Guarantees three things for every API response: clinical content is never
 * cached by a shared cache, error bodies are sanitised, and unexpected failures
 * are logged with a correlation id the user can quote.
 */

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
} as const;

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { ...NO_STORE, ...(init?.headers ?? {}) },
  });
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "request";
      (details[key] ??= []).push(issue.message);
    }

    return NextResponse.json(
      { error: { code: "VALIDATION", message: "The request was not valid.", details } },
      { status: 422, headers: NO_STORE },
    );
  }

  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.status, headers: NO_STORE },
    );
  }

  const correlationId = newCorrelationId();
  logServerError(error, correlationId);

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL",
        message: `Something went wrong. Reference: ${correlationId}`,
      },
    },
    { status: errorStatus(error), headers: NO_STORE },
  );
}

/** Wraps a handler so no unexpected throw escapes as an unsanitised 500. */
export function withApiErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (error) {
      return jsonError(error);
    }
  };
}

/** Parses a JSON body defensively — a malformed body is a 422, not a crash. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION", "The request body could not be read.");
  }
}
