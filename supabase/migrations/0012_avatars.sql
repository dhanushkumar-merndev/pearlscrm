-- Pearls Aesthetic Clinical Library
-- 0012: profile pictures.
--
-- Same direct-to-Tigris presigned flow as clinical images, scoped to the
-- caller's own profile instead of a case/visit/view slot. Two deliberate
-- differences from clinical images, because an avatar is a personal photo, not
-- a clinical original:
--   - only one avatar per user is retained; a replacement's old object is
--     deleted rather than kept as permanent version history;
--   - the read URL is long-lived (see AVATAR_READ_URL_TTL_SECONDS in
--     src/lib/env/server.ts) instead of minutes, because it is rendered on
--     every page rather than viewed occasionally in a case tab. 604800 seconds
--     (7 days) is not a style choice: it is the hard maximum SigV4 allows
--     (@smithy/signature-v4 MAX_PRESIGNED_TTL) — the application mints a fresh
--     one on every request that needs it, which is why a week-long individual
--     URL is still effectively "always current" rather than a stale credential.

alter table public.profiles
  add column if not exists avatar_object_key text;

-- ---------------------------------------------------------------------------
-- avatar_upload_sessions — idempotency + orphan cleanup, mirrors
-- image_upload_sessions minus the case/visit/view relationship.
-- ---------------------------------------------------------------------------
create table if not exists public.avatar_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  bucket text not null,
  object_key text not null unique,
  expected_mime_type text not null,
  expected_file_size bigint not null,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  constraint avatar_upload_sessions_status_allowed
    check (status in ('PENDING', 'FINALIZED', 'ABANDONED'))
);

create index if not exists avatar_upload_sessions_user_idx on public.avatar_upload_sessions (user_id);

create index if not exists avatar_upload_sessions_status_idx
  on public.avatar_upload_sessions (status, expires_at);

alter table public.avatar_upload_sessions enable row level security;

alter table public.avatar_upload_sessions force row level security;

-- Server-only, same as image_upload_sessions: no policy for `authenticated`,
-- so only the service-role admin client (used exclusively behind
-- `requireUser()` in src/server/services/avatar.ts) can touch this table.

-- ---------------------------------------------------------------------------
-- finalize_avatar_upload — atomic: repoint profiles.avatar_object_key, mark
-- the session finalized, return the key that was replaced so the caller can
-- delete that now-orphaned object from Tigris. Idempotent on the session.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_avatar_upload(
  p_session_id uuid,
  p_actor uuid default auth.uid()
)
returns table (object_key text, previous_object_key text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.avatar_upload_sessions;
  v_previous text;
begin
  select * into v_session
  from public.avatar_upload_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'upload session not found' using errcode = 'P0002';
  end if;

  if v_session.user_id <> p_actor then
    raise exception 'this upload belongs to a different user' using errcode = '42501';
  end if;

  -- Idempotent replay: the object key never changes on retry, and the profile
  -- was already repointed on the first successful call.
  if v_session.status = 'FINALIZED' then
    return query select v_session.object_key, null::text;
    return;
  end if;

  if v_session.status = 'ABANDONED' then
    raise exception 'this upload was cancelled' using errcode = 'P0001';
  end if;

  select p.avatar_object_key into v_previous
  from public.profiles p
  where p.id = p_actor;

  update public.profiles
  set avatar_object_key = v_session.object_key
  where id = p_actor;

  update public.avatar_upload_sessions
  set status = 'FINALIZED', finalized_at = now()
  where id = v_session.id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor, 'AVATAR_UPDATED', 'profile', p_actor,
    jsonb_build_object('had_previous', v_previous is not null)
  );

  return query select v_session.object_key, v_previous;
end;
$$;

revoke all on function public.finalize_avatar_upload(uuid, uuid) from public;

grant execute on function public.finalize_avatar_upload(uuid, uuid) to service_role;

