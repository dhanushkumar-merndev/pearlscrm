import type { RoleCode } from "@/lib/types";

/**
 * Central permission catalogue.
 *
 * The UI reads these to decide what to render; the server reads the *same*
 * table before performing any mutation. Hiding a button is never the control —
 * `requirePermission` on the server and RLS in the database are.
 */
export const PERMISSIONS = {
  "case:create": ["ADMIN", "DOCTOR"],
  "case:update": ["ADMIN", "DOCTOR"],
  "case:archive": ["ADMIN"],
  "case:restore": ["ADMIN"],
  "case_access:manage": ["ADMIN"],

  "visit:create": ["ADMIN", "DOCTOR"],
  "visit:update": ["ADMIN", "DOCTOR"],
  "visit:delete": ["ADMIN"],

  "image:upload": ["ADMIN", "DOCTOR"],
  "image:replace": ["ADMIN", "DOCTOR"],
  "image:remove": ["ADMIN", "DOCTOR"],
  "image:mark_unavailable": ["ADMIN", "DOCTOR"],
  "image:read": ["ADMIN", "DOCTOR", "VIEWER"],

  // Asking to reopen a submitted scope; deciding on that request is admin-only.
  "edit_request:create": ["ADMIN", "DOCTOR"],
  "edit_request:decide": ["ADMIN"],

  "notes:update": ["ADMIN", "DOCTOR"],

  "consent:record": ["ADMIN", "DOCTOR"],

  // The expert review is Dr. Praveen's, and Dr. Praveen holds the ADMIN role.
  // Nobody else reads or writes it: the tab is not rendered for other roles and
  // the server refuses the write regardless.
  "review:read": ["ADMIN"],
  "review:update": ["ADMIN"],
  "review:complete": ["ADMIN"],

  "master_data:create": ["ADMIN", "DOCTOR"],
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
  DOCTOR: "Doctor",
  VIEWER: "Viewer",
};
