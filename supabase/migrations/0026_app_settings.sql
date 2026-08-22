-- AURA Clinical Data Library
-- 0026: administrator-editable application settings.
--
-- Introduced for the storage allowance and rate. Tigris publishes no plan or
-- billing endpoint on its S3-compatible API, so the application cannot discover
-- what the clinic is paying for; somebody has to tell it. Putting that in an
-- environment variable means a redeploy every time a plan changes, and means
-- the Storage screen shows no "Available" figure at all until someone with
-- deployment access gets involved.
--
-- One small key/value table instead, written only through the server with an
-- administrator check and an audit event.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint app_settings_key_not_blank check (btrim(key) <> '')
);

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
alter table public.app_settings force row level security;

-- No policy for `anon` or `authenticated`: nothing reads or writes this table
-- from a user's own session. Every access goes through server code that has
-- already checked the administrator permission and uses the service role, which
-- bypasses RLS. An empty policy set is the deny-by-default that RLS gives us.
