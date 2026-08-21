import { describe, expect, it } from "vitest";

import { PERMISSIONS, ROLE_LABELS, can, canAny, type Permission } from "@/lib/permissions";

const ROLES = ["ADMIN", "DOCTOR", "VIEWER"] as const;

describe("can", () => {
  it("denies everything to an unknown or missing role", () => {
    expect(can(null, "case:create")).toBe(false);
    expect(can(undefined, "case:create")).toBe(false);
  });

  it("grants ADMIN every permission", () => {
    const permissions = Object.keys(PERMISSIONS) as Permission[];
    for (const permission of permissions) {
      expect(can("ADMIN", permission)).toBe(true);
    }
  });

  it("keeps VIEWER read-only", () => {
    expect(can("VIEWER", "case:create")).toBe(false);
    expect(can("VIEWER", "image:upload")).toBe(false);
    expect(can("VIEWER", "notes:update")).toBe(false);
    expect(can("VIEWER", "consent:record")).toBe(false);
    expect(can("VIEWER", "review:read")).toBe(false);
    expect(can("VIEWER", "review:update")).toBe(false);
    expect(can("VIEWER", "review:complete")).toBe(false);
    expect(can("VIEWER", "master_data:create")).toBe(false);
    expect(can("VIEWER", "master_data:manage")).toBe(false);
    expect(can("VIEWER", "user:manage")).toBe(false);
    expect(can("VIEWER", "audit:read")).toBe(false);
    expect(can("VIEWER", "case:archive")).toBe(false);
    expect(can("VIEWER", "visit:delete")).toBe(false);
    expect(can("VIEWER", "image:replace")).toBe(false);
    expect(can("VIEWER", "image:mark_unavailable")).toBe(false);
    expect(can("VIEWER", "image:read")).toBe(true);
  });

  it("restricts administration to ADMIN", () => {
    for (const role of ["DOCTOR", "VIEWER"] as const) {
      expect(can(role, "user:manage")).toBe(false);
      expect(can(role, "audit:read")).toBe(false);
      expect(can(role, "master_data:manage")).toBe(false);
      expect(can(role, "case:archive")).toBe(false);
      expect(can(role, "case:restore")).toBe(false);
      expect(can(role, "visit:delete")).toBe(false);
    }
  });

  it("allows DOCTOR to manage clinical work but not administration or expert review", () => {
    expect(can("DOCTOR", "case:create")).toBe(true);
    expect(can("DOCTOR", "case:update")).toBe(true);
    expect(can("DOCTOR", "image:upload")).toBe(true);
    expect(can("DOCTOR", "image:replace")).toBe(true);
    expect(can("DOCTOR", "image:mark_unavailable")).toBe(true);
    expect(can("DOCTOR", "visit:create")).toBe(true);
    expect(can("DOCTOR", "visit:update")).toBe(true);
    expect(can("DOCTOR", "notes:update")).toBe(true);
    expect(can("DOCTOR", "consent:record")).toBe(true);
    expect(can("DOCTOR", "master_data:create")).toBe(true);
    expect(can("DOCTOR", "review:read")).toBe(false);
    expect(can("DOCTOR", "review:update")).toBe(false);
    expect(can("DOCTOR", "review:complete")).toBe(false);
    expect(can("DOCTOR", "user:manage")).toBe(false);
    expect(can("DOCTOR", "visit:delete")).toBe(false);
  });
});

describe("canAny", () => {
  it("is true when any listed permission matches", () => {
    expect(canAny("DOCTOR", ["user:manage", "case:create"])).toBe(true);
    expect(canAny("VIEWER", ["case:create", "image:upload"])).toBe(false);
  });
});

describe("ROLE_LABELS", () => {
  it("labels every role", () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });
});
