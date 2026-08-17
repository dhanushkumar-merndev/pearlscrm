/**
 * Error handling.
 *
 * Clients receive a stable code and a short human message. Database errors,
 * SQL, stack traces, storage credentials and internal identifiers are logged
 * server-side and never serialised into a response.
 */

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[]>;

  constructor(code: AppErrorCode, message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const unauthenticated = (message = "You must sign in to continue.") =>
  new AppError("UNAUTHENTICATED", message);

export const forbidden = (message = "You do not have permission to perform this action.") =>
  new AppError("FORBIDDEN", message);

export const notFound = (message = "The requested record could not be found.") =>
  new AppError("NOT_FOUND", message);

export const validationFailed = (message: string, details?: Record<string, string[]>) =>
  new AppError("VALIDATION", message, details);

export const conflict = (message: string) => new AppError("CONFLICT", message);

export type SafeErrorBody = {
  error: { code: AppErrorCode; message: string; details?: Record<string, string[]> };
};

/**
 * Converts anything thrown into a client-safe body.
 *
 * Unrecognised errors collapse to a generic INTERNAL message: the original is
 * logged with a correlation id, but nothing about it is returned.
 */
export function toSafeError(error: unknown, correlationId?: string): SafeErrorBody {
  if (error instanceof AppError) {
    return {
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    };
  }

  logServerError(error, correlationId);

  return {
    error: {
      code: "INTERNAL",
      message: correlationId
        ? `Something went wrong. Reference: ${correlationId}`
        : "Something went wrong. Please try again.",
    },
  };
}

export function errorStatus(error: unknown): number {
  return error instanceof AppError ? error.status : 500;
}

const REDACTED = "[redacted]";

/**
 * Strips anything that must never reach a log line: signed URLs, keys, tokens.
 */
export function redactForLogging(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"']*[?&]X-Amz-Signature=[^\s"'&]*/gi, `${REDACTED}(signed-url)`)
    .replace(/(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g, `${REDACTED}(jwt)`)
    .replace(/(secret|password|token|key)["'\s:=]+[^\s,"'}]+/gi, `$1=${REDACTED}`);
}

export function logServerError(error: unknown, correlationId?: string) {
  const prefix = correlationId ? `[${correlationId}] ` : "";
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  console.error(`${prefix}${redactForLogging(message)}`);

  if (error instanceof Error && error.stack) {
    console.error(redactForLogging(error.stack));
  }
}

export function newCorrelationId(): string {
  return crypto.randomUUID().slice(0, 8);
}
