# CONTINUE.md — Pearls Aesthetic Clinic Library

Handoff document for the next coding session. Read `AGENTS.md` first — it is the locked
specification. This file only records **what is already done** and **what remains**, with
enough detail to resume without re-exploration.

---

## 0. Project Snapshot

- **Stack (locked):** Next.js 16.3 (App Router, React 19.2) + TypeScript + Tailwind v4 +
  shadcn/ui (radix-ui, cmdk, sonner) + Supabase (PostgreSQL, Auth, RLS) + Tigris Data
  (private S3 bucket, presigned URLs) + Zod + date-fns. Package manager: **pnpm**.
- **Hosting target:** Cloudflare (Next.js 16 supported path — see Task 4).
- **Workspace:** `D:\Projects\July\pearls-full-code\pearls-crm`
- **Commands:**
  - `pnpm dev` — dev server
  - `npx tsc --noEmit` — typecheck (currently **passes, 0 errors**)
  - `pnpm lint` — ESLint (**passes, 0 errors / 0 warnings**; `.open-next/` generated
    artifacts are ignored in `eslint.config.mjs`; if lint OOMs on a full `next build`
    cache, run with `NODE_OPTIONS=--max-old-space-size=8192`)
  - `pnpm test` — Vitest, **72/72 green** (6 suites)
  - `pnpm build` — **passes** (real credentials are in `.env`)
  - `pnpm deploy:cf` — **works**; deployed at
    https://pearls-crm.pearlsasthetic.workers.dev — see Task 4.
- **Directory map:** `src/app` (routes), `src/components` (ui/ + feature components),
  `src/lib` (supabase/tigris clients, validation, dates, types), `src/server`
  (actions/queries/services/auth), `supabase/migrations` (9 files) + `seed.sql`,
  `src/middleware.ts` (Edge middleware — session refresh + auth redirect + `no-store`
  header; the Next 16 `proxy.ts` file was removed because OpenNext CF cannot run the
  Node runtime proxy).

---

## 1. Verified Current State (accurate, supersedes the previous progress table)

| Area | Status | Notes |
|---|---|---|
| Migrations + seed | **DONE** | `0001`–`0009` + `seed.sql` in `supabase/`. **Applied to the real project `rhtfiiligsjdqgpnwoxp`** (supabase link + `db push` + seed via `db query`); verified counts: roles=4, image_view_types=6, procedure_types=2, followup_label_presets=4, migrations=9. |
| Auth (sign-in, session helper, permissions) | **DONE** | `src/server/auth/session.ts`, `src/lib/permissions.ts`, auth forms, `middleware.ts`. Forgot/reset password flows and the email-link callback were removed on request — passwords are set by the administrator at account creation. |
| Dashboard | **DONE** | `src/app/(app)/dashboard/page.tsx` (real DB queries, no fake data). |
| Cases list + filters + create + detail header/tabs | **DONE** | URL-driven server-side filters/sort/pagination (`cases-filters.tsx`, `cases-table.tsx`). |
| Type-or-create combobox | **DONE** | `src/components/app/type-or-create-combobox.tsx` + `master-data-combobox.tsx`; actions in `src/server/actions/master-data.ts` (case-insensitive dedupe via `normalized_key`). |
| Visits (Before + follow-ups) | **DONE** | `followups-tab.tsx`, `followup-dialog.tsx` (suggested-label logic via `src/lib/followup.ts` + `suggestVisitLabel` action). |
| Tigris images (authorize/finalize/abandon routes, read URL route, slot cards, secure lazy image, viewer, history, mark-unavailable, replacements, upload client) | **DONE** | `src/lib/tigris/*`, `src/lib/upload-client.ts`, `src/components/clinical-images/*`, 4 API routes. |
| Case notes (structured form, changes list, optimistic concurrency, conflict UI) | **DONE** | `case-notes-tab.tsx` + `src/server/actions/notes.ts` (versioned `WHERE version = expected`). |
| Consent + Expert review | **DONE** | `case-consent-tab.tsx`, `case-review-tab.tsx`, actions `consent.ts`, `review.ts`. |
| Users admin | **DONE** | `users-table.tsx`, `invite-user-dialog.tsx`, `src/server/actions/users.ts` (invite, role change, disable + session revoke). |
| Master data admin | **DONE** | `master-data-manager.tsx` + `settings/master-data/page.tsx`. |
| Audit log admin | **DONE** | `audit/page.tsx`, `audit-filters.tsx` (**new this session**), `audit-table.tsx` (**new this session**), `audit-details.tsx` (refuses to render secret-like metadata). |
| Completion logic | **DONE** | SQL function `case_completion(uuid)` (migration 0008) + `src/lib/completion.ts`. |
| `.env.example` | **DONE** | All vars documented. |
| **Tests** | **DONE (unit)** | Vitest 4 configured (`vitest.config.ts`, `test`/`test:watch` scripts), 6 suites / 72 tests green: `case-number`, `master-data`, `followup`, `completion`, `permissions`, `dates`. **Remaining:** integration + RLS deny tests (need a real Supabase project) and optional E2E (Playwright). |
| **Lint** | **DONE** | 0 errors, 0 warnings (all `set-state-in-effect` issues fixed; RHF `incompatible-library` and unused-var warnings resolved with justified suppressions). |
| **README** | **DONE** | Full setup (Supabase migrations + admin creation, Tigris, env), roles table, testing, security model, Cloudflare deploy steps. |
| **Cloudflare deploy** | **DONE — live** | Deployed at https://pearls-crm.pearlsasthetic.workers.dev. Two blockers fixed via one committed `pnpm` patch (`patches/@opennextjs__cloudflare.patch`): the sharp `.node` esbuild failure (in `bundle-server.js`, **not** `createServerBundle.js`) and a Next 16 `getMiddlewareManifest` dynamic-require that 500'd every page. `NEXT_PUBLIC_SITE_URL` now holds the real URL in both `.env` (build-time inlining) and `wrangler.jsonc`. Unauthenticated smoke tests all pass — see Task 4. |
| **UI rebrand (this session)** | **DONE** | App renamed **AURA → Pearls Aesthetic Clinic Library** (root layout metadata + template, sidebar brand block, auth layout; README/AGENTS/CONTINUE headers). Theme matches the clinic's landing page (`pearls/` site): warm sand/cream background, dark brown primary + gold accent (oklch values in `globals.css`), Playfair Display serif headings + Plus Jakarta Sans body via `next/font/google`, clinic logo + favicons copied into `public/` (`logo.png`, `favicon.ico`, `apple-touch-icon.png`, `icon-192/512.png`), sidebar shows logo + "Pearls Aesthetic / Clinic Library", auth pages show logo + serif brand. |
| **Security/DoD verification** | **PARTIAL** | `pnpm build` passes with all routes; no `auth.signUp` anywhere (invite-only); `.gitignore` covers `.env*`, `.open-next/`, `.wrangler/`; **bundle leak check done: `.next/static` contains no `SUPABASE_SERVICE_ROLE_KEY`/`TIGRIS_*` names — only `NEXT_PUBLIC_SUPABASE_*` (correct).** **Remaining:** RLS deny tests, manual E2E smoke against real Supabase + Tigris, bucket-privacy check in console. |

Session note: `npx tsc --noEmit` exits 0 today. The previous phase report
("Visits 45% UI pending", "Tigris 60% UI pending", etc.) is **out of date** — those UIs
already exist. The real remaining work is: lint cleanup, tests, docs/deploy, verification.

---

## 2. Task 1 — Fix lint — **DONE** (0 errors, 0 warnings)

> Kept for reference: the fixes applied are described below. `pnpm lint` is clean.
> Original heading: "Fix lint: 7 errors, 4 warnings".

Run `pnpm lint` to confirm. All 7 errors are the same rule:
`react-hooks/set-state-in-effect` (new React-Hooks ESLint v6 rule). Fixes below.

### 2.1 `src/hooks/use-mobile.ts:14`
```ts
mql.addEventListener("change", onChange)
setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)   // ← error line
```
This is the stock shadcn hook; rewrite it with `useSyncExternalStore` (the modern
pattern that satisfies the rule):
```ts
export function useMobile() {
  const getSnapshot = () => window.innerWidth < MOBILE_BREAKPOINT;
  const subscribe = (cb: () => void) => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    mql.addEventListener("change", cb);
    return () => mql.removeEventListener("change", cb);
  };
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
```

### 2.2 `src/components/clinical-images/image-history-dialog.tsx:43-44`
```ts
useEffect(() => {
  if (!open) return;
  let cancelled = false;
  setEntries(null);   // ← error
  setError(null);     // ← error
  void getImageHistory({ clinicalImageId }).then(...)
}, [open, clinicalImageId]);
```
Fix: reset the two states **in the `onOpenChange` handler** instead of in the effect:
```ts
onOpenChange={(next) => { onOpenChange(next); if (next) { setEntries(null); setError(null); } }}
```
then remove the two `set*` calls from the effect (fetch-on-open effects are fine —
the rule only objects to the synchronous setState calls).

### 2.3 `src/components/followups/followup-dialog.tsx:59-64` (and line 71)
```ts
useEffect(() => {
  if (!open) return;
  setVisitDate(visit?.visit_date ?? "");      // ← errors 59, 61, 62, 63, 64
  ...
}, [open, visit]);

useEffect(() => {
  ...
  if (visitDate < surgeryDate) {
    setDateError("The visit date is before the surgery date.");  // ← error 71
```
Two problems. Recommended restructure:
- **Reset-on-open:** move the five `set*` calls into the parent's
  `onOpenChange={(next) => { onOpenChange(next); if (next) resetForm(); }}` where
  `resetForm()` sets visitDate/label/observation/labelEdited/error/dateError. Or render
  the dialog content with `key={visit?.id ?? "new"}` and initialize state directly from
  props via `useState` initialisers — the cleanest fix: move the dialog's inner content
  into a child component mounted only while open, with `useState` initialised from props
  (no effect needed at all).
- **Date validation:** derive `dateError` during render instead of in an effect:
  `const dateError = visitDate && visitDate < surgeryDate ? "..." : null;` and delete
  the whole second effect's validation branch (keep only the label-suggestion fetch
  part, which is legitimate fetch-on-change).

### 2.4 `src/components/clinical-images/secure-image.tsx:46`
```ts
if (typeof IntersectionObserver === "undefined") {
  setVisible(true);   // ← error
  return;
}
```
Fix: initialise `useState(() => eager || typeof IntersectionObserver === "undefined")`
in the `useState` initialiser and delete the fallback branch — or disable the line with a
justified comment. Keep the observer callback `setVisible(true)` (that is event-driven,
not effect-body, and is allowed).

### 2.5 `src/components/clinical-images/visit-images-panel.tsx:57`
```ts
useEffect(() => {
  void load();   // ← error
}, [load]);
```
`load()` fetches visit slots and calls `setError`/`setSlots` in `.then` — async, so the
rule's analysis trips on the synchronous chain. This is a legitimate fetch-on-mount.
Options: (a) `// eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, state updates are async`; or (b) keep the effect but make `load` return the
promise and call `setSlots` inside `.then` (already the case — so option (a) is the
pragmatic fix). Same pattern may exist elsewhere; search the file for other effects.

### 2.6 `src/components/app/type-or-create-combobox.tsx:73`
```ts
useEffect(() => {
  setSelected(selectedValue);   // ← error
}, [selectedValue]);
```
Prop→state sync. Use the React-recommended "adjust state during render" pattern:
```ts
if (selected?.id !== selectedValue?.id) {
  setSelected(selectedValue);   // allowed during render for derived resets
}
```
place it directly in the component body before the return (no effect), or give the
combobox a `key` from the parent whenever `selectedValue` changes.

### 2.7 Warnings (4)
- `src/components/case-notes/case-notes-tab.tsx:133` and
  `src/components/cases/create-case-form.tsx:250` —
  `Compilation Skipped: Use of incompatible library` (eslint-plugin-react-hooks can't
  analyse a `react-hook-form` version). Verify these are warnings only, leave as-is.
- `src/server/actions/image-slots.ts:47` — `_key`/`_bucket` unused vars (deliberate
  "placeholder the client never uses" per the comment). Leave, or prefix differently.

**Definition of done for Task 1:** `pnpm lint` exits 0 with no errors (warnings OK if
justified), `npx tsc --noEmit` still exits 0, `pnpm dev` boots.

---

## 3. Task 2 — Test suite — **UNIT DONE (72/72), integration + RLS deny tests REMAINING**

### 3.1 Setup
1. Add a `test` script to `package.json`:
   `"test": "vitest run"` (and optionally `"test:watch": "vitest"`).
2. Add `vitest.config.ts` (vitest 4 is already a devDependency, as are
   `@vitest/coverage-v8` and `dotenv`):
   ```ts
   import { defineConfig } from "vitest/config";
   import { fileURLToPath } from "node:url";

   export default defineConfig({
     test: {
       environment: "node",
       include: ["src/**/*.{test,spec}.{ts,tsx}"],
       coverage: { include: ["src/lib/**", "src/server/**"] },
     },
     resolve: {
       alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
     },
   });
   ```
   Tests must be pure unit tests against `src/lib/*` (no DB/Tigris/Next needed) plus
   RLS policy tests that run against a Supabase instance (see 3.4). Do **not** import
   `server-only` modules (`src/server/actions/*` are `"use server"` + `server-only` —
   they will throw outside Next). Mock the S3 client via the existing test hook in
   `src/lib/tigris/server.ts` (`/** Test hook so a suite can swap in a stub client. */`).

### 3.2 Unit tests (pure, no infra)
Create `src/lib/*.test.ts` alongside each module:
1. **`src/lib/case-number.ts`** — formatting: `RH-0001` zero-padding, prefix constant,
   larger numbers (`RH-1245`), rejects invalid input.
2. **`src/lib/master-data.ts`** — `normalizeMasterKey`: trims, collapses whitespace,
   lowercases; duplicate detection (`"RHINOPLASTY"` → same key as `"Rhinoplasty"`);
   punctuation preserved (`"3 Months"`, `"A-P"` unchanged).
3. **`src/lib/followup.ts`** — interval calculation: exact presets (1/3/6/12 months),
   custom labels for non-matching intervals, visit-before-surgery handling.
4. **`src/lib/completion.ts`** — completion calculation against
   `CaseCompletionFacts`: all-true → complete; each missing piece (consent, notes,
   review, before images, follow-ups) → incomplete; NOT_AVAILABLE counts as resolved
   for before images.
5. **`src/lib/permissions.ts`** — role → permission matrix: VIEWER denies
   `cases:create`/`images:upload`/`notes:write`; SURGEON allows review actions;
   STAFF denies `user:manage`, `audit:read`, `master_data:manage`; ADMIN allows all.
6. **`src/lib/dates.ts`** — `formatClinicDate` (`2026-01-12` → `12/01/2026`), no
   timezone day-shift for `date` values, invalid input → `—`; `daysBetween` (DST-safe).

### 3.3 Integration tests (with a real Supabase + Tigris dev setup, or mocks)
Use `@supabase/supabase-js` with the **service role key from test env** (never the
anon key), applying migrations `0001`–`0009` + seed to a disposable test project:
1. Create case → RH number generated, audit `CASE_CREATED` row exists.
2. `createMasterValueAction`-equivalent logic: new procedure "Preservation
   Rhinoplasty" persisted; second call with different casing returns the **existing**
   record (no duplicate; `usage_count` increment).
3. Image replacement flow: upload version A, replace with B → B is `current_version`,
   A has `superseded_at` set, both rows exist, `IMAGE_REPLACED` audit row.
4. Consent change → `CONSENT_RECORDED` then `CONSENT_CHANGED` audit rows.
5. Review PENDING → IN_REVIEW → COMPLETED with `reviewer_id` + `reviewed_at`, audited.
6. Archive case → excluded from default list query; restore works.

### 3.4 RLS / security tests (the critical ones, AGENTS.md §20, §51, §52)
For each, connect with a real user session (or `auth.uid()` impersonation where
supported) and assert the denied operations **error**:
- Unauthenticated client (`anon` key, no session): cannot `select` `cases`,
  `case_visits`, `clinical_images`, `clinical_image_versions`, `case_notes`,
  `case_consents`, `case_reviews`, `audit_logs`.
- VIEWER: `select` OK on cases, `insert`/`update`/`delete` fail everywhere.
- STAFF: `insert` on `cases` OK, but `insert`/`update` on `audit_logs` fails; cannot
  `update` a `case_review` (surgeon-only action is enforced in DB policies).
- Guessing UUIDs: VIEWER/STAFF cannot read another case's images by constructing
  `clinical_image_versions.object_key` lookups (policy joins through `cases`).
- Disabled user (`profiles.is_active = false`): every policy rejects.
- Normal users cannot `delete` from `audit_logs` (append-only enforcement).

### 3.5 E2E (optional for this session — no Playwright dep installed)
If added, use Playwright against the deployed/dev app with the AGENTS.md §52 critical
path (admin signs in → creates case → types new procedure → uploads Before/Front →
adds 1-month follow-up → uploads images → notes → consent → review → completion →
viewer read-only).

---

## 4. Task 3 — README — **DONE** (needs the deployed URL added)

Replace the create-next-app boilerplate with real documentation:
1. **What it is** — secure clinical case library (rhinoplasty), one paragraph.
2. **Stack** — one line each: Next.js 16, Supabase (Auth/Postgres/RLS), Tigris private
   bucket, shadcn/ui, Zod.
3. **Local setup** — numbered steps:
   - `pnpm install`
   - Create Supabase project; run migrations `0001`–`0009` + `seed.sql` in order
     (supabase CLI: `supabase db push` or SQL editor paste).
   - Create Tigris bucket (PRIVATE) + credentials.
   - `Copy-Item .env.example .env` / `cp .env.example .env.local`; fill every var
     (list each with what it is).
   - `pnpm dev`; sign in as the seeded admin (create the first admin via Supabase
     dashboard or `seed.sql`'s documented flow).
4. **Roles** — ADMIN / SURGEON / STAFF / VIEWER table with capabilities.
5. **Deployment (Cloudflare)** — see Task 4, then link to it.
6. **Testing** — `pnpm test`, what the suites cover.
7. **Security model** — bullet list: RLS on every table, presigned short-lived URLs,
   immutable image objects, no public sign-up, audit append-only, no secrets in
   browser bundle.

---

## 5. Task 4 — Cloudflare deployment — **DONE (deployed and smoke-tested)**

**Live URL:** https://pearls-crm.pearlsasthetic.workers.dev
(Worker `pearls-crm`, account `pearlsasthetic@gmail.com`.)

### What is deployed

- `@opennextjs/cloudflare` 1.20.2 + `wrangler` 4.x; `open-next.config.ts` =
  `defineCloudflareConfig()`.
- `wrangler.jsonc`: name `pearls-crm`, `compatibility_date 2026-08-01`,
  `nodejs_compat`, `assets` binding, observability on, and `vars` with the real
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
  `NEXT_PUBLIC_SITE_URL` (now the real workers.dev URL, no longer a placeholder).
- All 6 secrets present on the Worker (`wrangler secret list` confirms):
  `SUPABASE_SERVICE_ROLE_KEY`, `TIGRIS_ENDPOINT`, `TIGRIS_REGION`, `TIGRIS_BUCKET`,
  `TIGRIS_ACCESS_KEY_ID`, `TIGRIS_SECRET_ACCESS_KEY`.
- `NEXT_PUBLIC_SITE_URL` is **inlined at build time**, so it must also exist in the
  build environment — it is in `.env` and documented in `.env.example`. Setting it only
  in `wrangler.jsonc` is not enough.

### The two deploy blockers, and how they were fixed

Both fixes live in a single committed patch, `patches/@opennextjs__cloudflare.patch`,
registered under `patchedDependencies` in `pnpm-workspace.yaml` (pnpm 11 puts it there,
not in `package.json`). It reapplies automatically on `pnpm install`, including in CI.
If a future `@opennextjs/cloudflare` upgrade makes the patch fail to apply, that failure
is the signal to re-check whether upstream has fixed these.

**1. `sharp` broke the esbuild Worker bundle**

```
ERROR No loader is configured for ".node" files:
node_modules/.pnpm/@img+sharp-win32-x64@0.35.3/.../sharp-win32-x64-0.35.3.node
```

The previous session diagnosed this as `createServerBundle.js`. It is **not** — that
bundle is fine. A probe on `esbuildAsync` showed the server-function bundle completing,
and the failure landing in the *next* step, `bundle-server.js` ("⚙️ Bundling the OpenNext
server..."), which is a plain `esbuild.build()` in the Cloudflare package. Patching
`createServerBundle`'s `external` therefore changed nothing.

Fix: alias `sharp` to OpenNext's existing `cloudflare-templates/shims/throw.js` in the
`alias` map of `bundle-server.js` — exactly the treatment `@vercel/og` already gets a few
lines above. `sharp` is reached only from `getSharp()` in
`next/dist/server/image-optimizer.js`, behind a lazy `require("sharp")` inside a
try/catch; `images.unoptimized: true` means that call site never runs, and the native
binary could not run in workerd anyway.

Rejected alternatives: `external: ["sharp"]` would leave an unresolvable import in the
Worker; adding `sharp` to `bundle-server.js`'s `optionalDependencies` list would make the
`handleOptionalDependencies` plugin *inline* it (it only stubs deps that are **not**
installed, and sharp is installed as a Next optional dependency).

**2. Every page 500'd with a dynamic-require error**

After the bundle built and deployed, `/sign-in` returned 500. `wrangler tail`:

```
Error: Dynamic require of "/.next/server/middleware-manifest.json" is not supported
  at NextNodeServer.getMiddlewareManifest
```

Next 16's `getMiddlewareManifest()` is `return this.minimalMode ? null : require(this.middlewareManifestPath)`.
OpenNext patches `loadManifest`/`evalManifest` and stubs `loadNodeMiddleware`, but has no
patch for this method, so the raw dynamic require reached workerd.

Fix: a `disableMiddlewareManifestRule` ast-grep patch in
`patches/plugins/next-server.js` that rewrites the method to `return null` — which is
what Next itself returns in minimal mode, and the correct answer under OpenNext: the
middleware is bundled separately to `.open-next/middleware/handler.mjs` and invoked by
the Worker entrypoint *before* the Next server runs, so the server must not run it again.
`getMiddleware()` already null-checks the manifest, and `loadNodeMiddleware` is stubbed.

### Other change made while deploying

`src/middleware.ts` no longer redirects unauthenticated `/api/*` requests to `/sign-in`.
A `fetch()` follows a redirect transparently, so the upload client saw `ok: true` on an
HTML page instead of an auth error. API routes now fall through to their own
`requirePermission`, which returns the JSON 401 envelope. Verified live.

### Smoke test results (against the deployed Worker)

| Check | Result |
|---|---|
| `/` unauthenticated | 307 → `/sign-in` |
| `/dashboard` unauthenticated | 307 → `/sign-in?next=%2Fdashboard` |
| `/sign-in` | 200, renders the branded form (20 KB) |
| `/forgot-password` | 200 |
| `/auth/callback` (no code) | 307 → `/sign-in?error=link_invalid` |
| `/auth/callback?code=invalid` | 307 → `/sign-in?error=link_expired` — proves the Worker reached the real Supabase API |
| `POST /api/uploads/authorize` unauth | 401 `{"error":{"code":"UNAUTHENTICATED",…}}` |
| `POST /api/uploads/finalize` unauth | 401 (same) |
| `GET /api/images/<uuid>/url` unauth | 401 (same) |
| `Cache-Control` on `/sign-in` | `no-store, must-revalidate` |
| Secret scan of `.open-next/assets` (36 files) | no `SUPABASE_SERVICE_ROLE_KEY` / `TIGRIS_*` values present |

### Still unverified on the live Worker (needs real credentials / a browser)

Sign-in with a real account, dashboard and cases rendering, create-case →
type-or-create procedure, the Tigris upload round trip (presigned PUT + finalize +
presigned read), and image replacement. These are the manual E2E items in Task 5.

---

## 6. Task 5 — Verification pass (AGENTS.md §51 checklist + §71 DoD)

Needs real credentials. Sequence:
1. **Fill `.env`** with real Supabase + Tigris values (current file is only the
   template; check `git status`/`.gitignore` that it stays untracked).
2. `pnpm build` — must pass.
3. Apply migrations + seed to a **clean** Supabase project; confirm they succeed in
   order from an empty DB.
4. Walk the §51 security checklist:
   - `grep` the built bundle for `SUPABASE_SERVICE_ROLE_KEY`, `TIGRIS_SECRET`,
     `TIGRIS_ACCESS_KEY` — must be absent (`NEXT_PUBLIC_*` values only).
   - Tigris bucket policy = private (console check).
   - RLS deny tests from Task 2 pass against this project.
   - No public sign-up (confirm `auth.admin.inviteUserByEmail` is the only user
     path; `signUp` is not called anywhere — grep for it).
   - Upload MIME/size limits enforced (check `src/lib/images.ts` allowed types;
     HEIC intentionally **excluded** — documented, do not "fix" it).
   - Replacements versioned; originals immutable (covered by tests).
   - Error responses sanitised (server actions return `{ ok: false, error: { code,
     message } }` via `src/server/actions/result.ts` — spot-check no raw SQL/stack
     leaks).
5. Manual smoke of the AGENTS.md §52 E2E critical path in dev against real Supabase +
   Tigris (sign-in, create case, new procedure from combobox, upload Before/Front,
   add follow-up, upload follow-up images, notes save, consent, review complete,
   completion % updates, viewer read-only).
6. Run `pnpm lint` + `npx tsc --noEmit` + `pnpm test` at the end and record results.

**Progress (this session):** items 1–3 are DONE — `.env` has real values
(`UPLOAD_URL_TTL_SECONDS=1800`, `READ_URL_TTL_SECONDS=1800`, `MAX_IMAGE_BYTES=5242880`),
`pnpm build` passes, migrations `0001`–`0009` + seed were applied to the linked
project `rhtfiiligsjdqgpnwoxp` (`supabase db push`; CLI 2.114.0 has no `db reset
--remote` and no `db execute` — seed was loaded via `supabase db query --linked -f
supabase/seed.sql`). Remaining: RLS deny + integration tests against this project,
Tigris bucket-privacy console check, and the manual smoke (item 5).

---

## 7. Known Constraints & Gotchas (read before changing anything)

- **No patient identifiers anywhere** (§28, §63): object keys use UUIDs, UI shows
  `RH-XXXX` only. Do not add patient name/phone/email/DOB fields.
- **Never overwrite a Tigris object** (§11, §41): replacement = new version row +
  supersede old; UI shows current version only.
- **`audit-details.tsx`** deliberately hides metadata keys containing
  `secret|token|password|key|signature|url|object_key|bucket` — keep audit writers
  consistent (never write clinical narrative into `metadata`).
- **RLS policies** (migration `0007`) join through `cases` for images/visits/notes —
  don't weaken; server actions also re-check permissions (§19 "hiding a button is
  not authorization").
- **Concurrency** (§25): `case_notes.version` and `case_reviews.version` are
  optimistic-lock columns; UI shows a conflict alert and offers reload — keep that
  behaviour, never force-overwrite.
- **Dates** (§46): SQL `date` values are handled as `YYYY-MM-DD` strings
  (`src/lib/dates.ts`) — never round-trip through `new Date()` for pure dates.
- **Env validation** (`src/lib/env/server.ts`) throws at runtime with descriptive
  messages; `resetServerEnvCache()` exists as a test hook.
- **`src/middleware.ts`** is the Edge middleware (replaces the deleted Next 16
  `src/proxy.ts`, which OpenNext CF cannot run — see Task 4) — if you create new
  public routes, add them to `PUBLIC_PATHS`. Do NOT convert it back to `proxy.ts`
  and do NOT add `export const runtime = "edge"` to any file (Next 16 rejects it in
  proxy files).
- **Completion** is dynamic (SQL `case_completion(uuid)` in migration `0008`); don't
  hardcode percentages in components.
- **Follow-up labels** are presentation-only; `visit_date` is authoritative
  (`suggestVisitLabel` action + `src/lib/followup.ts`).

---

## 8. Suggested Execution Order

1. ~~Task 1 (lint)~~ — green.
2. ~~Task 3 (README)~~ — done.
3. ~~Task 2 (tests, unit)~~ — 72/72 green; integration/RLS suites still to write (can
   now run against the real project `rhtfiiligsjdqgpnwoxp`).
4. Task 5 (verification) — `.env` filled and DB migrated; RLS deny tests, Tigris
   bucket-privacy check and manual smoke remain.
5. Task 4 (Cloudflare deploy) — unblock the sharp esbuild issue (see Task 4
   BLOCKER), then deploy + set `NEXT_PUBLIC_SITE_URL`.
6. Final: re-run typecheck + lint + tests + `pnpm build`, then walk §71 DoD and §51
   checklist, updating this file's "Verified Current State" table.

Status on handoff: Typecheck ✅ · Lint ✅ (0 errors) · Unit tests ✅ (72/72) · Build ✅ ·
README ✅ · UI rebrand ✅ (Pearls Aesthetic Clinic Library theme) · Cloudflare config ✅
(secrets uploaded; deploy BLOCKED on sharp esbuild `.node` loader — Task 4) ·
Integration/RLS tests ❌ (Task 2.3) · Live verification ❌ (Task 5).