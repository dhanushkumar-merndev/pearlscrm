# Known Issues — Pearls Aesthetic Clinic Library

Last updated: 2026-08-21
Deployment: https://pearls-crm.pearlsasthetic.workers.dev
Database: Supabase `rhtfiiligsjdqgpnwoxp`, migrations 0001–0024 applied, local and remote in sync.

**Verification status of this document.** Everything under "Evidence" was measured against the
live database or the running toolchain. Everything under "Suspected cause" is reasoning, not
measurement, and is labelled as such. The application has never been driven end to end through a
browser by the author of this file, so absence from this list is not evidence of correctness.

---

## P1 — Clinical images reach storage but are not recorded

**Status:** open, actively recurring.

Uploading is three steps: `authorize` (create a `PENDING` session, return a presigned URL) →
`PUT` (browser sends bytes straight to Tigris) → `finalize` (confirm the object landed, write the
immutable version row, repoint the slot, mark the session `FINALIZED`).

Step 3 is failing. The images are safely in Tigris; nothing in the database points at them, so
the case shows empty slots.

**Evidence**
- Orphaned `PENDING` sessions: **6 at 16:30, 16 by 18:20** — the failure is ongoing, not historical.
- All checked objects exist in Tigris with the correct byte length and `image/png` content type.
- Tigris handled 6 parallel `PUT` + `HEAD` with zero failures, using the same credentials.
- `finalize_image_upload` is healthy — a probe with a non-existent session returns `P0002` as designed.
- Sessions remain `PENDING`, so the RPC never committed: the throw happens *before* it.
- The user-facing error was the generic `Something went wrong. Reference: <id>`, which
  `jsonError` only emits for a non-`AppError` throw.

**Suspected cause (unconfirmed):** `headObject` is the only unguarded external call before the
RPC. It has since been wrapped, so a recurrence now logs `[finalize:head:<session>]` with the real
exception and returns a specific message.

**Next step:** reproduce once and read the terminal line beginning `[finalize:head:` or
`[finalize:rpc:`. That will name the cause outright.

**Where:** `src/server/services/images.ts` (`finalizeUpload`), `src/app/api/uploads/finalize/route.ts`

---

## P1 — Cloudflare Error 1102 in production

**Status:** open, not root-caused.

The deployed Worker intermittently returns `Error 1102 — Worker exceeded resource limits`.
Reported as happening on image upload viewed in admin, and clearing on refresh.

**Evidence**
- Observed on `pearls-crm.pearlsasthetic.workers.dev`, Ray ID `a2e9c0222a52601a`.
- `.open-next/server-functions/default` is **33 MB**.
- No `limits` block in `wrangler.jsonc`, so the account's default CPU ceiling applies.

**Suspected cause (unconfirmed):** per-request CPU on heavier SSR renders. Note that Supabase and
Tigris calls are I/O and do not consume Worker CPU, so the cost is likely render work rather than
query count.

**Next step:** `wrangler tail` while reproducing, to identify the route and whether the limit hit
is CPU or memory. Confirm the account plan — the free tier's CPU ceiling is far below what
Next.js SSR needs.

---

## P1 — No database, RLS, integration or end-to-end tests

**Status:** open. Required by `AGENTS.md` §52; `AGENTS.md` §51 lists RLS deny tests as a
production gate.

**Evidence**
- 78 tests across 7 files, all pure functions: case numbers, completion maths, dates, follow-up
  intervals, master-data normalisation, the permission table, staged image changes.
- Tests touching the database, a server action, or RLS: **none**.
- E2E harness: **none** (no Playwright or Cypress config).

**Impact.** The highest-risk logic in the repository is unverified: that a VIEWER cannot write,
that a DOCTOR cannot reach the expert review, that a disabled account is refused, that one user
cannot read another's notifications, that the edit-approval grant is single use, and that the
staged-upload path works at all.

**Suggested first step:** RLS deny tests. Highest value per line of code in this project.

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

**Status:** open. Required by `AGENTS.md` §54 ("do not silently orphan objects indefinitely").

16 sessions currently sit `PENDING` with real objects in Tigris and no path to reclaim them.
Sessions carry `expires_at`, but nothing acts on it. Storage grows with every failed upload.

**Note:** any cleanup must only ever touch `PENDING`/`ABANDONED` sessions. A finalized clinical
original is immutable and must never be deleted.

---

## P2 — Two tables still fetch unbounded or truncate silently

**Status:** open. Same class of defect as the tag filter fixed in migration 0024.

| Screen | Query | Behaviour |
|---|---|---|
| Users & Access | `listUsers()` — no `limit`, no `range` | fetches every profile |
| Settings → Master data | `.limit(500)` per table | truncates with nothing on screen to say so |

Currently harmless — 21 users — but `procedures` already holds **245** rows against that 500 cap,
so master data is the nearer of the two.

**Where:** `src/server/actions/users.ts:185`, `src/server/services/master-data.ts:150`

---

## P3 — "Latest follow-up" sort cannot use an index

`case_list_view.latest_followup_date` is produced by a lateral subquery, so ordering by it forces
that lateral to be computed for every matching row before sorting. It is the slowest path in the
case list.

Irrelevant at 4 cases; estimated 100–300 ms at 10,000. If it becomes a problem, denormalise the
value onto `cases` with a trigger rather than restructuring the view.

---

## P3 — Offset pagination has a ceiling

Server-side offset pagination is in place on cases, audit logs, case audit history, approvals
(pending and decided) and the changes feed. This is the correct choice at the clinic's scale and
needs no change for 10,000 cases.

It does not scale to a million rows: `OFFSET 50000` still scans everything before it. The fix at
that point is keyset pagination (`WHERE created_at < $last`), not virtualization — nothing here
renders enough DOM rows for a virtualizer to help.

---

## P3 — The critical path has never been manually verified

No one has walked: create case → save Before → save After → add follow-up → request edit →
administrator approves → re-save → confirm the grant is spent. `AGENTS.md` §69 defines this as
the acceptance criteria. Compile-time checks pass, but they cannot substitute for this.

---

## Resolved in this session

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
