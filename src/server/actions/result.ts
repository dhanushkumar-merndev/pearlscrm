import "server-only";

import { ZodError } from "zod";

import { AppError, newCorrelationId, logServerError, type AppErrorCode } from "@/lib/errors";

/**
 * Uniform server-action envelope.
 *
 * Actions never throw across the RSC boundary: they return a discriminated
 * result so the client can render a precise message without ever seeing a
 * database error, SQL, or a stack trace.
 */

export type ActionSuccess<T> = { ok: true; data: T };

export type ActionFailure = {
  ok: false;
  error: { code: AppErrorCode; message: string; details?: Record<string, string[]> };
};

export type ActionResult<T> = ActionSuccess<T> | ActionFailure;

export async function actionResult<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "Please correct the highlighted fields.",
          details: fieldErrors(error),
        },
      };
    }

    if (error instanceof AppError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      };
    }

    const correlationId = newCorrelationId();
    logServerError(error, correlationId);

    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: `Something went wrong. Reference: ${correlationId}`,
      },
    };
  }
}

function fieldErrors(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    (details[key] ??= []).push(issue.message);
  }

  return details;
}
