-- Pearl Aesthetic Clinic Library
-- 0034: browser push for notifications (Firebase Cloud Messaging, web only).
--
-- Same Firebase project and server key as the Pearl Sales CRM, but this app
-- is a website: tokens come from the browser (firebase/messaging getToken with
-- a VAPID key) and there is no Android app or platform column.
--
-- Flow: a row lands in public.notifications → the trigger below asks the app
-- (pg_net, after commit) to deliver it → POST {site}/api/push/dispatch with the
-- x-push-secret header → the app reads push_payload() and sends FCM HTTP v1.
-- The in-app bell already has the notification; push only makes the browser
-- show it. Tokens Firebase no longer knows are removed.
--
-- Two Vault secrets switch delivery on (nothing is sent while either is
-- missing, so local databases and previews stay quiet):
--
--   select vault.create_secret('https://<your-site>', 'push_site_url');
--   select vault.create_secret('<same value as PUSH_DISPATCH_SECRET>', 'push_dispatch_secret');

begin;

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 1. Browser tokens
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_tokens_token_length check (char_length(token) between 20 and 4096),
  constraint push_tokens_user_agent_length check (user_agent is null or char_length(user_agent) <= 200)
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id, last_seen_at desc);

alter table public.push_tokens enable row level security;
alter table public.push_tokens force row level security;

drop policy if exists push_tokens_select_own on public.push_tokens;
create policy push_tokens_select_own on public.push_tokens
  for select to authenticated using (user_id = auth.uid());

drop policy if exists push_tokens_delete_own on public.push_tokens;
create policy push_tokens_delete_own on public.push_tokens
  for delete to authenticated using (user_id = auth.uid());

-- Registration goes through this function so a browser that changes hands
-- (shared front-desk computer) moves to the person now signed in.
create or replace function public.register_push_token(p_token text, p_user_agent text, p_actor uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.profiles where id = p_actor and is_active) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  insert into public.push_tokens (user_id, token, user_agent)
  values (p_actor, p_token, left(p_user_agent, 200))
  on conflict (token) do update
    set user_id = excluded.user_id, user_agent = excluded.user_agent, last_seen_at = now();

  -- Keep the ten most recent browsers per person.
  delete from public.push_tokens
  where user_id = p_actor
    and id not in (
      select id from public.push_tokens where user_id = p_actor order by last_seen_at desc limit 10
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. What the dispatch route reads and writes
-- ---------------------------------------------------------------------------
create table if not exists public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  finished_at timestamptz not null default now(),
  ok boolean not null,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists job_runs_job_idx on public.job_runs (job, finished_at desc);

alter table public.job_runs enable row level security;
alter table public.job_runs force row level security;

create or replace function public.push_payload(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', n.id,
    'type', n.type,
    'title', n.title,
    'body', coalesce(n.body, ''),
    'case_id', n.case_id,
    'visit_id', n.visit_id,
    'visit_type', v.visit_type,
    'read', n.read_at is not null,
    'tokens', coalesce((
      select jsonb_agg(t.token order by t.last_seen_at desc)
      from (
        select token, last_seen_at from public.push_tokens
        where user_id = n.recipient_id
        order by last_seen_at desc
        limit 10
      ) t
    ), '[]'::jsonb)
  )
  from public.notifications n
  join public.profiles p on p.id = n.recipient_id and p.is_active
  left join public.case_visits v on v.id = n.visit_id
  where n.id = p_id;
$$;

create or replace function public.push_tokens_drop(p_tokens text[])
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  delete from public.push_tokens where token = any (coalesce(p_tokens, '{}'::text[]));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.push_log_run(p_ok boolean, p_detail jsonb)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.job_runs (job, ok, detail)
  values ('push-send', coalesce(p_ok, false), coalesce(p_detail, '{}'::jsonb));
  -- Keep a rolling month.
  delete from public.job_runs where job = 'push-send' and finished_at < now() - interval '30 days';
$$;

-- ---------------------------------------------------------------------------
-- 3. Trigger: ask the app to deliver each new notification
-- ---------------------------------------------------------------------------
create or replace function public.push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from public.push_tokens where user_id = new.recipient_id) then
    return new;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_site_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return new;
  end if;

  -- pg_net queues the request and sends it after commit; a failure here never
  -- blocks the clinical write that raised the notification.
  begin
    perform net.http_post(
      url := rtrim(v_url, '/') || '/api/push/dispatch',
      body := jsonb_build_object('id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'push dispatch could not be queued: %', sqlstate;
  end;

  return new;
end;
$$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  for each row execute function public.push_on_notification();

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'public.register_push_token(text, text, uuid)',
    'public.push_payload(uuid)',
    'public.push_tokens_drop(text[])',
    'public.push_log_run(boolean, jsonb)',
    'public.push_on_notification()'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated;', sig);
    execute format('grant execute on function %s to service_role;', sig);
  end loop;
end;
$$;

commit;
