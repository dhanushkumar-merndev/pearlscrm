# Known Issues — Pearls Aesthetic Clinic Library

Last updated: 2026-08-22
Deployment: https://pearls-crm.pearlsasthetic.workers.dev
Database: Supabase `rhtfiiligsjdqgpnwoxp`. Migrations 0001–0024 applied. **0025, 0026 and 0027 are
written but NOT applied** — run `supabase db push`.

**Verification status of this document.** Everything under "Evidence" was measured against the live
database, the live Tigris bucket, or the running toolchain. Everything under "Suspected cause" is
reasoning, not measurement, and is labelled as such. The application has still never been driven end
to end through a browser, so absence from this list is not evidence of correctness.

---

## P0 — Privileged database functions were callable without a session

**Status:** fix written (`0027_revoke_privileged_function_execute.sql`), **not yet applied**.

Found by the new RLS deny suite. Twelve `security definer` functions could be invoked with nothing
but the public anon key — no session, with an attacker-chosen `p_actor`, running as the function
owner.

**Evidence** — each called with the anon key and nil UUIDs. A sealed function answers `42501
permission denied for function` *before* running; these ran:

| Function | Anon response | What it does |
|---|---|---|
| `decide_edit_request` | `P0002 edit request not found` | approves/rejects edit requests |
| `grant_edit_access` | `P0002 case not found` | grants any user edit access to any case |
| `create_edit_request` | `P0002 case not found` | opens an edit request |
| `consume_edit_grant` | succeeded | spends a grant |
| `submit_visit_images` | `P0002 visit not found` | locks a visit's image set |
| `remove_current_image` | `P0002 image not found` | empties a clinical image slot |
| `finalize_avatar_upload` | `P0002 upload session not found` | repoints a profile avatar |
| `upsert_master_value` | `23503` on the actor FK — **reached the INSERT** | writes master data |
| `set_master_value_active` | `P0002 master value not found` | enables/disables master data |
| `notify_admins` | `23503` on the actor FK — **reached the INSERT** | writes notifications |
| `set_case_access` | `42501 administrator access required` (its own check) | sets case visibility |
| `next_case_number` | `42501 permission denied for sequence` (grant, not the function) | allocates RH numbers |

Nothing was actually written: every call was stopped by a nil-UUID lookup, an actor foreign key or a
table grant. Those are second lines of defence, not the intended one.

**Cause (confirmed).** Supabase's default privileges grant EXECUTE on new functions in `public` to
`anon` and `authenticated`. The migrations said `revoke all ... from public`, and revoking from
PUBLIC does not remove a grant made directly to a role — so the lockdown never took effect for these.
`finalize_image_upload`, `create_case` and `mark_image_unavailable` happened to be sealed.

**Fix.** 0027 revokes EXECUTE from `anon` and `authenticated` on all sixteen privileged functions and
narrows `alter default privileges` so the hole cannot reopen for functions added later. Safe by
construction: every one is invoked from server code through the service-role client. `case_completion`
— the one function a user's own session calls — and the RLS policy helpers are deliberately untouched.

**Verify after pushing:** `pnpm test:rls` must go green. It fails 12 tests today, correctly.

---

## P1 — Clinical images reach storage but are not recorded

**Status:** no longer reproducing; recovery and cleanup now exist.

**What the evidence actually shows.** All 17 orphaned sessions belong to one visit (RH-0001 Before)
and to two bursts, at 15:53 and 16:22 IST on 21 August. Every upload after that succeeded:

```
15:53–15:54  11 sessions   RH-0001 Before   all PENDING
16:22        5 sessions    RH-0001 Before   all PENDING
16:40        1 session     RH-0001 After    FINALIZED in 2s
18:17–18:18  6 sessions    RH-0004 Before   all FINALIZED in 2–4s
```

The earlier note called this "actively recurring" because the orphan count rose from 6 to 16 between
two checks. It rose because nothing cleaned the old ones up — not because new ones were failing. The
last batch, three-way concurrent on a fresh Before visit, finalized cleanly.

The two failing bursts sit immediately after the deploys at 15:39 and 16:21, on the one visit that
had been locked and reopened via an edit grant. That is consistent with the finalize hardening
landing between them, and it is as far as the evidence goes.

**Ruled out by measurement:**
- `headObject` is not the cause. `HEAD` on the stuck objects returns the correct byte length and
  content type today, matching what was authorized.
- The RPC is healthy, and the objects are intact in Tigris.

**What changed.** The failure mode — bytes safe, nothing pointing at them — is now recoverable
instead of silent:
- `reconcileVisitUploads` runs when a visit's image panel opens. A stuck session whose slot is still
  empty is finalized; the image appears. Failures are logged and swallowed.
- Settings → Storage shows unrecorded objects and offers an explicit sweep.
- `finalizeSessionRecord` is split out of `finalizeUpload` so recovery does not have to impersonate
  the original uploader's request.

Recovery is conservative by design: a stuck session is only finalized when its slot holds **no**
current version. If the slot has since been filled, the object is released rather than allowed to
supersede an image already on record.

**Still open:** the 16 orphans predate the fix and are waiting on a sweep (they will also heal on
first view of RH-0001's Before tab).

**Where:** `src/server/services/upload-reconciliation.ts`, `src/server/services/images.ts`

---

## P1 — Cloudflare Error 1102 in production

**Status:** open, not root-caused. Unchanged — this one needs a live reproduction.

The deployed Worker intermittently returns `Error 1102 — Worker exceeded resource limits`, reported
on image upload viewed in admin and clearing on refresh.

**Evidence**
- Observed on `pearls-crm.pearlsasthetic.workers.dev`, Ray ID `a2e9c0222a52601a`.
- `.open-next/server-functions/default` is **33 MB**.
- No `limits` block in `wrangler.jsonc`, so the account's default CPU ceiling applies.

**Suspected cause (unconfirmed):** per-request CPU on heavier SSR renders. Supabase and Tigris calls
are I/O and do not consume Worker CPU, so the cost is likely render work rather than query count.

**Next step:** `wrangler tail` while reproducing, to identify the route and whether the limit hit is
CPU or memory. Confirm the account plan first — the free tier's 10 ms CPU ceiling is far below what
Next.js SSR needs, and if the account is on it that is the whole answer.

Note: `limits.cpu_ms` in `wrangler.jsonc` can only *lower* the ceiling, so adding it would not help.

---

## P1 — Test coverage: RLS deny tests now exist; integration and E2E do not

**Status:** partially closed.

**Done.** `tests/rls/anon-deny.test.ts`, run with `pnpm test:rls` against a real project:
- every clinical table and master table refuses an unauthenticated select, and leaks no count;
- all sixteen privileged functions must refuse execution before running;
- fabricated image and version ids return nothing.

It found the P0 above on its first run, which is the argument for it.

Kept out of `pnpm test` so the unit suite stays hermetic — separate config, separate script. Table
assertions are read-only; function assertions call with nil UUIDs so a hole fails on lookup or on the
actor foreign key rather than writing.

**Still missing**
- Role-based write denial (VIEWER cannot update, STAFF cannot perform admin actions, a disabled
  account is refused, one user cannot read another's notifications, the edit grant is single use).
  These need a disposable project: proving a write is refused means attempting one.
- Integration tests over the server actions.
- E2E: no Playwright or Cypress config.

**Unit suite:** 80 tests across 8 files, all pure functions.

---

## P2 — Administrator password exposed

**Status:** open, needs a human action.

`Pearls@2026Aesthetic` for `admin@pearlsaesthetic.com` appeared in terminal scrollback and in an
assistant transcript. The cause — Next's dev server logging Server Function arguments, including
`signIn` and `createUser` passwords — is fixed via `logging: { serverFunctions: false }` in
`next.config.ts`. The exposed credential itself is not.

**Action:** rotate the password.

---

## P2 — No cleanup for unfinalized uploads

**Status:** closed, pending a run.

Settings → Storage reports unrecorded objects and offers **Reconcile now**, which:
- finalizes an orphan whose slot is still empty (the image is recovered, not deleted);
- deletes the object and closes the session when the slot has since been filled, or when nothing was
  ever uploaded.

A finalized clinical original is never touched — the sweep only ever acts on `PENDING` sessions, and
only ever deletes an object no version row references.

Per-visit reconciliation also runs automatically when an image panel opens, so an orphan heals
without anyone visiting Settings.

---

## P2 — Two tables fetched unbounded or truncated silently

**Status:** closed.

| Screen | Before | Now |
|---|---|---|
| Users & Access | `listUsers()` — no `limit`, no `range`; `auth.admin.listUsers({ perPage: 1000 })` | 50 per page with an exact total, `Showing 1–50 of N`, prev/next. Auth details fetched for the ids on the page only. |
| Settings → Master data | `.limit(500)` per table, filtered in the browser | Search and paging run in the database; `Showing 1–50 of 245`. A value past the cap is now findable. |

The audit page took the whole user list only to label a filter dropdown; it now uses
`listUserOptions()`, which reads `id, display_name` and never touches the auth admin API.

**Where:** `src/server/actions/users.ts`, `src/server/services/master-data.ts`

---

## P3 — "Latest follow-up" sort cannot use an index

`case_list_view.latest_followup_date` is produced by a lateral subquery, so ordering by it forces
that lateral to be computed for every matching row before sorting. It is the slowest path in the
case list.

Irrelevant at 4 cases; estimated 100–300 ms at 10,000. If it becomes a problem, denormalise the value
onto `cases` with a trigger rather than restructuring the view.

---

## P3 — Offset pagination has a ceiling

Server-side offset pagination is in place on cases, audit logs, case audit history, approvals,
the changes feed, users and master data. This is the correct choice at the clinic's scale and needs
no change for 10,000 cases.

It does not scale to a million rows: `OFFSET 50000` still scans everything before it. The fix at that
point is keyset pagination (`WHERE created_at < $last`), not virtualization — nothing here renders
enough DOM rows for a virtualizer to help.

---

## P3 — The critical path has never been manually verified

No one has walked: create case → save Before → save After → add follow-up → request edit →
administrator approves → re-save → confirm the grant is spent. `AGENTS.md` §69 defines this as the
acceptance criteria. Compile-time checks and the deny suite pass, but they cannot substitute for this.

---

## Note — the storage plan is not measurable

Settings → Storage measures the Tigris bucket directly: bytes held, object count, largest object,
newest and oldest upload, the per-case breakdown, and which objects no case points at. All of that is
a live `ListObjectsV2`.

The **allowance and the rate are not**. Tigris publishes no plan, quota or billing endpoint on its
S3-compatible API, so the access keys the application holds can read objects but not the
subscription. The allowance defaults to Tigris's published 5 GB free tier and is edited by an
administrator; the estimate is charged on the overflow only, and the screen links to the Tigris
console, which remains the authority on what is actually billed.

---

## Resolved earlier

| Issue | Resolution |
|---|---|
| Tag filter broke at ~300 tagged cases — 5000-row cap with silent truncation, and ids sent in the URL (≈10.9 KB at 300 tags, over an 8 KB request line) | Migration 0024 adds `case_list_view.tag_ids`; filter is now a single containment test in SQL |
| Combobox discarded the user's selection on the next render, so picking a procedure showed the placeholder | Reconciliation now keys off the controlled `value`, not the optional `selectedValue` |
| Edit dialogs showed placeholders over populated fields | Combobox resolves its own label from a bare id, including inactive historical values |
| `finalize` captured the Postgres `error` and threw it away, leaving a correlation id with no matching log line | Logs `code`, `message`, `details`, `hint`; two distinct client messages |
| `revalidatePath` ran after the version row was committed and could fail a successful upload | Wrapped — a cache hint can no longer fail a completed write |
| Profile menu item was hard-coded `disabled` with no route | Real `/profile` page: display name, plus password change gated on the current password |
| "Edit approval requested" notifications opened the case instead of the approvals queue | Routed by notification type |
| Next dev server logged `signIn` and `createUser` arguments, including passwords | `logging: { serverFunctions: false }` |
| Select menus rendered over the trigger | `position="popper"`, `align="start"`; removed a viewport height clamp that collapsed the list |
| Vertical scrollbar on tab strips | `overflow-y-hidden` on the horizontal scroll wrappers |
| Audit details wrapped at a fixed `max-w-md`, then later forced onto one line and scrolled off screen | Wraps only when it genuinely does not fit |
| `localhost:3000` returned 404 when signed in | Root route redirects to `/dashboard` |
| Migrations 0010–0013 existed remotely but not in the repo; new migrations silently collided | Real migrations recovered; new work renumbered to 0014–0016 |
| After images could be uploaded before Before existed | Enforced in `authorizeUpload`, `submitVisitImages` and the UI |
| No warning when a phase was saved with fewer than six views | Standing warning plus a confirmation before an incomplete save |
