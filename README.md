# Pearls Aesthetic Clinic Library

A secure, audit-trailed clinical case library for Pearls Aesthetic Clinic: case metadata,
pre-operative and follow-up photographs, structured case notes, consent records,
surgeon expert review, and completion tracking.

The primary visible identifier for a case is `RH-0001`, `RH-0002`, … — UUIDs are used
internally and as the storage security boundary; sequential case numbers never are.

## Stack

- **Next.js 16** (App Router, React 19, TypeScript, Tailwind CSS) on **Cloudflare Workers**
- **shadcn/ui** components only (Radix + Lucide), no other component framework
- **Supabase** — Auth (invite-only, no public sign-up), PostgreSQL, Row Level Security
- **Tigris Data** — private S3-compatible bucket for original clinical images,
  short-lived presigned upload/read URLs only
- **Zod** validation on both client and server, **Vitest** for tests

Clinical images are never proxied through the app, never served from permanent URLs, and
original objects are never overwritten — replacements create new versions.

## Local setup

Prerequisites: Node.js ≥ 20, pnpm, a Supabase project, a Tigris bucket (private).

```bash
pnpm install
```

### 1. Database (Supabase)

1. Create a Supabase project.
2. Apply the migrations in order from `supabase/migrations/0001` to `0009`, then run
   `supabase/seed.sql` (reference data only — roles, image views, procedure types,
   follow-up presets; no fake cases).
   ```bash
   pnpm dlx supabase link --project-ref <your-project-ref>
   pnpm dlx supabase db push
   ```
   (Or paste each file into the Supabase SQL editor in order.)
3. Create the first user in the dashboard (Authentication → Users → Add user), then in
   the SQL editor:
   ```sql
   insert into public.profiles (id, display_name, role_id, is_active)
   select u.id, 'Clinic Admin', r.id, true
   from auth.users u
   cross join public.roles r
   where r.code = 'ADMIN'
   and not exists (select 1 from public.profiles p where p.id = u.id);
   ```

### 2. Environment

```bash
Copy-Item .env.example .env        # PowerShell
cp .env.example .env.local          # macOS/Linux
```

Fill every variable:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API (anon, **public** key) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (service role, **server only**) |
| `TIGRIS_ENDPOINT` | Tigris console (`https://fly.storage.tigris.dev` for the free tier) |
| `TIGRIS_REGION` | Tigris console (e.g. `auto`) |
| `TIGRIS_BUCKET` | The private bucket name |
| `TIGRIS_ACCESS_KEY_ID` / `TIGRIS_SECRET_ACCESS_KEY` | Tigris → Application Keys |

Never commit a filled `.env`. Only `NEXT_PUBLIC_*` values may reach the browser.

### 3. Run

```bash
pnpm dev
```

Open `http://localhost:3000` and sign in with the admin user created in step 1.

## Roles

| | ADMIN | SURGEON | STAFF | VIEWER |
|---|---|---|---|---|
| Create/edit cases | ✅ | — | ✅ | — |
| Upload/replace images | ✅ | — | ✅ | — |
| Case notes | ✅ | ✅ | ✅ | read-only |
| Consent records | ✅ | — | ✅ | — |
| Expert review | ✅ | ✅ | — | — |
| Master data | manage | create | create | — |
| Users / audit logs / archive | ✅ | — | — | — |
| View cases & images | ✅ | ✅ | ✅ | ✅ |

Authorization is enforced server-side on every action and again by RLS in the database —
hiding a button is never the control.

## Testing

```bash
pnpm test         # unit tests (Vitest)
pnpm test:watch
```

Unit suites cover case number formatting, master-value normalization, follow-up interval
suggestions, completion logic, the role/permission matrix, and date handling. RLS deny
tests are run against a real Supabase project with the service role key (see
`src/server` integration notes in `CONTINUE.md`).

## Deployment (Cloudflare Workers)

**Currently deployed:** https://pearls-crm.pearlsasthetic.workers.dev
(Worker `pearls-crm`.)

The app deploys through the official **`@opennextjs/cloudflare`** adapter (Node.js
runtime, fully supported for Next.js 16 — see https://opennext.js.org/cloudflare).

1. Install wrangler and log in:

   ```bash
   pnpm add -D wrangler @opennextjs/cloudflare   # already present
   pnpm dlx wrangler login
   ```

2. Set the server-only secrets (never committed):

   ```bash
   pnpm dlx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   pnpm dlx wrangler secret put TIGRIS_ENDPOINT
   pnpm dlx wrangler secret put TIGRIS_REGION
   pnpm dlx wrangler secret put TIGRIS_BUCKET
   pnpm dlx wrangler secret put TIGRIS_ACCESS_KEY_ID
   pnpm dlx wrangler secret put TIGRIS_SECRET_ACCESS_KEY
   ```

   Runtime tunables can be set the same way (`UPLOAD_URL_TTL_SECONDS`,
   `READ_URL_TTL_SECONDS`, `MAX_IMAGE_BYTES`) or omitted to use the defaults.

3. `NEXT_PUBLIC_*` variables are inlined at build time. Set them in the build
   environment (`.env`) **and** mirror them in `wrangler.jsonc` → `vars`.
   `NEXT_PUBLIC_SITE_URL` must be the deployed origin — it is what password-reset
   and invitation emails link back to. Setting it only in `wrangler.jsonc` is not
   enough, because the value is baked into the bundle at build time.

4. Preview locally:

   ```bash
   pnpm preview:cf
   ```

5. Deploy:

   ```bash
   pnpm deploy:cf
   ```

The Tigris bucket must remain **private**. Presigned URLs are generated per request and
expire in minutes; nothing permanent or public is ever exposed.

The bucket also needs a CORS rule so the browser can PUT directly to it:
origin = the deployed URL (plus `http://localhost:3000` for development), methods
`GET, HEAD, PUT`, allowed header `Content-Type` (required — the presigned PUT signs it),
expose header `ETag`. Leave `DELETE` out: orphan cleanup runs server-side with
credentials, never from the browser.

### Patched dependency

`patches/@opennextjs__cloudflare.patch` (registered in `pnpm-workspace.yaml` under
`patchedDependencies`, reapplied automatically by `pnpm install`) carries two fixes
needed to build and run on Workers:

1. **`bundle-server.js`** — aliases `sharp` to OpenNext's `throw.js` shim. `sharp` is a
   Next.js optional dependency reached only from the image optimizer's lazy
   `require("sharp")`; `images.unoptimized: true` means it never runs, and its native
   `.node` binary has no esbuild loader and cannot run in workerd.
2. **`patches/plugins/next-server.js`** — rewrites Next 16's `getMiddlewareManifest()`
   to `return null` (what Next returns in minimal mode). Its dynamic
   `require(middlewareManifestPath)` is unsupported in workerd and 500s every request.
   Returning null is correct under OpenNext: middleware is bundled separately and run by
   the Worker entrypoint before the Next server.

If a future adapter release makes the patch fail to apply, check whether these are fixed
upstream before re-patching.

## Security model

- Row Level Security enabled on every clinical table; policies join through `cases` and
  reject inactive users and unauthenticated sessions.
- No public registration — accounts exist only via admin invitation.
- Service role key, Tigris credentials and all secrets stay in server-only code
  (`server-only` guard + build-time check that they never reach the browser bundle).
- Clinical images: private bucket, immutable objects, versioned replacements,
  SHA-256/filename metadata, presigned short-lived uploads and reads.
- Audit log is append-only for normal users; it records changed field names and safe
  scalars, never clinical narrative or secrets.
- Case notes use optimistic concurrency (`version`); concurrent edits surface a
  conflict instead of silently overwriting.
- Response headers set `Cache-Control: no-store` for clinical content.

## Project layout

```
src/app          routes: (auth)/, (app)/dashboard|cases|users|settings|audit, api/uploads, api/images
src/components   ui/ (shadcn) + feature components (cases, clinical-images, followups, case-notes, audit, ...)
src/lib          supabase + tigris clients, env validation, dates, master-data, permissions, types
src/server       actions (use-case operations), queries (read models), services (audit, images), auth
supabase/        migrations 0001–0009 + seed.sql
wrangler.jsonc   Cloudflare Workers config (@opennextjs/cloudflare)
```
