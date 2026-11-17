# TODO — Patients, File IDs, Sessions, Surgery reminders, Web push

Status on 17/11/2026: **all features built and tested locally. Only deployment is pending.**

---

## ✅ Done and tested

Tested locally on 17/11/2026, on a separate copy of the database with all 34 migrations, in a real (slow-motion) Chrome window.

| # | Feature | Result |
|---|---------|--------|
| 1 | First visit + prescription + treatment plan | Registered a patient with referral, prescription upload (stored privately) and a 3-session plan ✅ |
| 2 | Branch File IDs (BG / KL / SH) | KL0001, KL0002… allocated automatically; 20 at once gave no gaps or duplicates ✅ |
| 3 | Mark for Surgery + reminders | Sets date + surgeon, shows reminder times (6 pm evening before, 8 am on the day) ✅ |
| 4 | Compulsory Before & After photos | "Complete session" stays locked until both photos are saved; the database also refuses ✅ |
| 5 | Comments, next visit, new treatments later | Rhinoplasty added after Laser → own number RH-0001; notes and next visit show on the timeline ✅ |
| 6 | Any doctor, any branch, types a File ID | A Brigade Road doctor typed `kl6` in Ctrl+K and opened KL0006's full history and referral banner ✅ |
| — | Reminder job (pg_cron, every 5 min) | Sent to the surgeon and that branch's admin/doctors only; marked SENT ✅ |
| — | Web push (Firebase, web only) | Browser got a real token → FCM "sent: 1" → notification appeared on screen ✅ |
| — | Push privacy | Text = File ID, case number, procedure, branch, date. No name or phone ✅ |
| — | Speed | Vercel region set to Mumbai (`vercel.json` → `bom1`), loading skeletons on every page, fewer Supabase calls per click. Locally each page change takes about 0.4 s ✅ |

Bugs found by the browser test and fixed:
- After adding the first session, its photo slots stayed hidden.
- Ctrl+K patient search crashed the page.
- Typing a short File ID (`kl5`) didn't find KL0005.

Checks: type-check ✅ · lint ✅ · 118 unit tests ✅ · `next build` ✅ · database access test (29 checks) ✅

---

## ⏳ Pending — deployment only (in this order)

> ⚠️ Run the migrations **before** deploying the new code, or the new pages will crash.
> Nothing is committed yet, so if Vercel deploys on every git push, don't push until step 2 is done.

### 1. Commit the work
- [ ] Review and commit (about 100 changed files, all uncommitted on `main`).

### 2. Live Supabase (project `rhtfiiligsjdqgpnwoxp`, Mumbai)
- [ ] `npx supabase login`, then `npx supabase db push` (needs the database password).
      Applies `0031_branches_patients`, `0032_treatments_sessions`, `0033_surgery_reminders`, `0034_web_push`.
      They turn on the `pg_cron` and `pg_net` extensions automatically.
- [ ] In the SQL editor, create the two Vault secrets (use the real Vercel address):
  ```sql
  select vault.create_secret('https://<your-vercel-domain>', 'push_site_url');
  select vault.create_secret('<same value as PUSH_DISPATCH_SECRET in .env>', 'push_dispatch_secret');
  ```

### 3. Vercel
- [ ] `npm i -g vercel` → `vercel login` → `vercel link`
- [ ] Add these to the Vercel project (Production): every Firebase entry from `.env`
      (`NEXT_PUBLIC_FIREBASE_*` including `NEXT_PUBLIC_FIREBASE_VAPID_KEY`),
      `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`, `PUSH_DISPATCH_SECRET`.
      The Supabase and Tigris variables are presumably already set.
- [ ] Deploy: `vercel --prod`
- [ ] Check in Vercel → Project → Settings → Functions that the region is **Mumbai (bom1)**.

### 4. After deploy
- [ ] Users & Access: give every staff member a **home branch** (reminders go to that branch's staff).
- [ ] Settings → Treatment numbering: check the case prefixes (RH-, LHR- …). Laser Hair Removal is not
      in the procedure list yet; it gets created the first time someone types it.
- [ ] Each doctor: Profile → "Notifications on this device" → On (or the "Turn on" banner).
- [ ] Quick live check: register a test patient → add a session → photos → mark a surgery → Ctrl+K search.

---

## Notes

- **Hosting:** the app now runs on **Vercel**. AGENTS.md still says Cloudflare; update it if staying on Vercel.
- **Sign-in check:** sessions are now checked with `getClaims()`, which verifies the token on the server
  using your project's ES256 signing keys. A disabled account is still blocked straight away. A stolen
  token would keep working for up to 1 hour after sign-out (Supabase's recommended trade-off).
- **AGENTS.md:** `next dev` adds a small "nextjs-agent-rules" block at the end of AGENTS.md on its own. Harmless.

## Local test setup (to run it again)

Everything lives in the scratchpad folder `/tmp/claude-1000/-mnt-ssd-data-Projects-2026-10-October-Pearl-Clinic-pearlscrm/23452988-5aac-4c76-8011-a9eb14ce646f/scratchpad/`,
which is temporary and may be cleared on reboot.

- Local Supabase: `localsb/` (project `pearlscrm-local`, ports 566xx; doesn't touch the Pearl CRM stack).
  Start or stop with `npx supabase start` / `npx supabase stop` inside `localsb/`.
- App against the local database: `run-local.sh` → http://localhost:3100
- Test logins (local only): `admin@pearl.local`, `doctor@pearl.local` (KL), `doctorbg@pearl.local` (BG); password `Test@12345`
- Slow-motion browser test: `cd pw && node flow.mjs` (set `SLOW=800` to make it slower)
- Screenshots: `pw/shots/`
