import "server-only";

import { AppError, conflict, forbidden, notFound, validationFailed } from "@/lib/errors";

/**
 * Maps errors raised by our own SECURITY DEFINER functions to safe app errors.
 *
 * Only the SQLSTATEs those functions raise deliberately carry their message to
 * the user — the messages are written for people ("Choose today or a future
 * date for surgery"). Anything else becomes a generic error with the detail
 * logged server-side, so SQL never reaches the browser.
 */
export function rpcError(
  error: { code?: string; message?: string } | null,
  fallback: string,
): AppError {
  const message = error?.message ?? fallback;
  switch (error?.code) {
    case "42501":
      return forbidden(message);
    case "P0002":
      return notFound(message);
    case "22023":
    case "23514":
      return validationFailed(message);
    case "40001":
      return conflict(message);
    case "23505":
      return conflict("That value is already in use.");
    default:
      return new AppError("INTERNAL", fallback);
  }
}
