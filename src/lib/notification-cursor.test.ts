import { describe, expect, it } from "vitest";

import { decodeNotificationCursor, encodeNotificationCursor } from "@/lib/notification-cursor";

describe("notification cursor", () => {
  const cursor = {
    createdAt: "2026-08-21T12:34:56.000Z",
    id: "5a6e05b1-8243-4cf6-8a4a-297270a89a4f",
  };

  it("round-trips a cursor suitable for a URL", () => {
    const encoded = encodeNotificationCursor(cursor);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeNotificationCursor(encoded)).toEqual(cursor);
  });

  it("rejects malformed values", () => {
    expect(decodeNotificationCursor("not a cursor")).toBeNull();
    expect(decodeNotificationCursor(undefined)).toBeNull();
  });
});
