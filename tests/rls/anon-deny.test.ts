import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Row Level Security deny tests, run against a real Supabase project.
 *
 * `AGENTS.md` §51 lists "RLS enabled and tested" and "RLS deny tests" as
 * production gates, and §52 names "unauthenticated user cannot select clinical
 * tables" as the first of them. The unit suite cannot cover this: RLS lives in
 * the database, and the only way to know a policy holds is to ask the database
 * with the credentials an attacker would have.
 *
 * Every table assertion is read-only. The function assertions are not quite:
 * proving that a privileged function refuses an anonymous caller means calling
 * it. Each is called with the nil UUID for every identifier and for `p_actor`,
 * so nothing can match a real row and the actor foreign key cannot resolve —
 * a function that runs anyway fails on lookup or on that key rather than
 * writing. That is a deliberate second line of defence, not a guarantee: prefer
 * a disposable project if you have one.
 *
 * Tests that need to prove a *write* is refused for a signed-in role (VIEWER
 * cannot update, STAFF cannot perform admin actions) are not here for the same
 * reason — they need a project whose data does not matter.
 *
 * Run with: `pnpm test:rls`
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const configured = Boolean(url && anonKey);

/**
 * Every table an unauthenticated caller must not be able to read.
 *
 * The list is exhaustive on purpose: a table added later without a policy is a
 * hole, and the only way this suite catches that is by naming every table it
 * expects to be sealed.
 */
const CLINICAL_TABLES = [
  "profiles",
  "roles",
  "cases",
  "case_visits",
  "clinical_images",
  "clinical_image_versions",
  "case_notes",
  "case_changes_performed",
  "case_consents",
  "case_reviews",
  "audit_logs",
  "image_upload_sessions",
  "avatar_upload_sessions",
  "case_edit_requests",
  "notifications",
  "case_access_grants",
  "app_settings",
] as const;

/** Master data is reference vocabulary, but still not public. */
const MASTER_TABLES = [
  "procedures",
  "procedure_types",
  "complication_types",
  "clinical_tags",
  "followup_label_presets",
  "image_view_types",
] as const;

const NIL = "00000000-0000-0000-0000-000000000000";

/**
 * Every argument below is the nil UUID, so nothing can match a real row. The
 * only thing these calls measure is whether the function is allowed to *start*:
 * a sealed function answers `42501 permission denied for function` before it
 * runs, while `P0002 ... not found` proves it ran.
 *
 * That distinction is what caught the holes migration 0027 closes, and it is
 * why these assert on the specific error rather than merely "an error
 * happened". Until 0027 is applied, twelve of them fail — correctly.
 */
const PRIVILEGED_RPCS: { name: string; args: Record<string, unknown> }[] = [
  { name: "create_case", args: { p_procedure_id: NIL, p_procedure_type_id: NIL, p_surgery_date: "2000-01-01", p_followup_availability: null, p_tag_ids: [], p_actor: NIL } },
  { name: "set_case_access", args: { p_case_id: NIL, p_user_ids: [], p_actor: NIL } },
  { name: "next_case_number", args: {} },

  { name: "create_edit_request", args: { p_case_id: NIL, p_scope: "VISIT_IMAGES", p_visit_id: NIL, p_reason: "rls deny test", p_actor: NIL } },
  { name: "decide_edit_request", args: { p_request_id: NIL, p_approve: false, p_note: "rls deny test", p_ttl_hours: 1, p_actor: NIL } },
  { name: "grant_edit_access", args: { p_case_id: NIL, p_scope: "VISIT_IMAGES", p_visit_id: NIL, p_user: NIL, p_reason: "rls deny test", p_ttl_hours: 1, p_actor: NIL } },
  { name: "consume_edit_grant", args: { p_request_id: NIL, p_actor: NIL } },

  { name: "finalize_image_upload", args: { p_session_id: NIL, p_file_size: 1, p_sha256: null, p_actor: NIL } },
  { name: "mark_image_unavailable", args: { p_visit_id: NIL, p_view_type_id: NIL, p_reason: null, p_actor: NIL } },
  { name: "remove_current_image", args: { p_clinical_image_id: NIL, p_actor: NIL } },
  { name: "submit_visit_images", args: { p_visit_id: NIL, p_grant_id: null, p_actor: NIL } },

  { name: "finalize_avatar_upload", args: { p_session_id: NIL, p_actor: NIL } },

  { name: "upsert_master_value", args: { p_table: "procedures", p_display_name: "rls deny test", p_actor: NIL } },
  { name: "set_master_value_active", args: { p_table: "procedures", p_id: NIL, p_is_active: false, p_actor: NIL } },

  { name: "notify_admins", args: { p_type: "rls_deny_test", p_title: "rls deny test", p_body: "rls deny test", p_case_id: null, p_visit_id: null, p_edit_request_id: null, p_actor: NIL } },
];

let anon: SupabaseClient;

beforeAll(() => {
  if (!configured) return;

  anon = createClient(url as string, anonKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

describe.skipIf(!configured)("RLS — unauthenticated access", () => {
  it("has no session", async () => {
    const { data } = await anon.auth.getUser();
    expect(data.user).toBeNull();
  });

  describe("clinical tables", () => {
    it.each(CLINICAL_TABLES)("returns no rows from %s", async (table) => {
      const { data, error } = await anon.from(table).select("*").limit(1);

      // Either shape is a correct denial: PostgREST returns an error when the
      // role lacks the grant, and an empty set when a policy filters it out.
      // What must never happen is a row coming back.
      if (error) {
        expect(error.code).toBeTruthy();
        return;
      }

      expect(data).toEqual([]);
    });

    it.each(CLINICAL_TABLES)("returns no count from %s", async (table) => {
      // `head: true` with an exact count is a separate PostgREST path from a
      // plain select, and a policy that filters rows must also zero the count —
      // otherwise the size of the clinical library leaks.
      const { count, error } = await anon
        .from(table)
        .select("*", { count: "exact", head: true });

      // A HEAD request carries no body, so PostgREST's error detail does not
      // survive: supabase-js reports the failure with an empty code. The only
      // thing worth asserting is that no count came back.
      if (error) {
        expect(count).toBeFalsy();
        return;
      }

      expect(count ?? 0).toBe(0);
    });
  });

  describe("master data", () => {
    it.each(MASTER_TABLES)("returns no rows from %s", async (table) => {
      const { data, error } = await anon.from(table).select("*").limit(1);

      if (error) {
        expect(error.code).toBeTruthy();
        return;
      }

      expect(data).toEqual([]);
    });
  });

  describe("privileged functions", () => {
    it.each(PRIVILEGED_RPCS.map((rpc) => [rpc.name, rpc.args] as const))(
      "refuses %s",
      async (name, args) => {
        const { error } = await anon.rpc(name, args);

        // Refused before running, not refused because the nil UUID matched
        // nothing. Any other outcome — including a clean success — means an
        // unauthenticated caller reached a privileged function body.
        expect(
          error && error.code === "42501" && /permission denied for function/i.test(error.message),
          `expected ${name} to refuse execution, got ${error ? `${error.code}: ${error.message}` : "success"}`,
        ).toBe(true);
      },
    );
  });

  describe("object access cannot be guessed", () => {
    it("refuses a clinical image by a fabricated id", async () => {
      const { data, error } = await anon
        .from("clinical_images")
        .select("id, case_id")
        .eq("id", "11111111-1111-1111-1111-111111111111");

      if (error) {
        expect(error.code).toBeTruthy();
        return;
      }

      expect(data).toEqual([]);
    });

    it("refuses a version row by a fabricated id", async () => {
      const { data, error } = await anon
        .from("clinical_image_versions")
        .select("id, object_key")
        .eq("id", "11111111-1111-1111-1111-111111111111");

      if (error) {
        expect(error.code).toBeTruthy();
        return;
      }

      expect(data).toEqual([]);
    });
  });
});

describe.skipIf(configured)("RLS deny tests", () => {
  it("is skipped without Supabase configuration", () => {
    // Present so an unconfigured run reports a skip rather than silently
    // passing an empty file — "0 tests" reads like "nothing to check".
    expect(configured).toBe(false);
  });
});
