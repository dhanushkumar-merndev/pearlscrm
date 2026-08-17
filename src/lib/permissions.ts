import type { RoleCode } from "@/lib/types";

/**
 * Central permission catalogue.
 *
 * The UI reads these to decide what to render; the server reads the *same*
 * table before performing any mutation. Hiding a button is never the control —
 * `requirePermission` on the server and RLS in the database are.
 */
export const PERMISSIONS = {
  "case:create": ["ADMIN", "STAFF"],
  "case:update": ["ADMIN", "STAFF"],
  "case:archive": ["ADMIN"],
  "case:restore": ["ADMIN"],

  "visit:create": ["ADMIN", "STAFF"],
  "visit:update": ["ADMIN", "STAFF", "SURGEON"],
  "visit:delete": ["ADMIN"],

  "image:upload": ["ADMIN", "STAFF"],
  "image:replace": ["ADMIN", "STAFF"],
  "image:mark_unavailable": ["ADMIN", "STAFF"],
  "image:read": ["ADMIN", "STAFF", "SURGEON", "VIEWER"],

  "notes:update": ["ADMIN", "STAFF", "SURGEON"],

  "consent:record": ["ADMIN", "STAFF"],

  "review:update": ["ADMIN", "SURGEON"],
  "review:complete": ["ADMIN", "SURGEON"],

  "master_data:create": ["ADMIN", "STAFF", "SURGEON"],
  "master_data:manage": ["ADMIN"],

  "user:manage": ["ADMIN"],
  "audit:read": ["ADMIN"],
} as const satisfies Record<string, readonly RoleCode[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: RoleCode | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly RoleCode[]).includes(role);
}

/** True when the role may perform *any* of the listed permissions. */
export function canAny(role: RoleCode | null | undefined, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

export const ROLE_LABELS: Record<RoleCode, string> = {
  ADMIN: "Administrator",
  SURGEON: "Surgeon",
  STAFF: "Clinical Staff",
  VIEWER: "Viewer",
};
