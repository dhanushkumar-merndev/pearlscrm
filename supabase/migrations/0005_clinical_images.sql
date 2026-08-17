-- AURA Clinical Data Library
-- 0005: clinical image slots, immutable version records, and upload sessions.

-- ---------------------------------------------------------------------------
-- clinical_images — the logical slot (visit x view).
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_images (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  visit_id uuid not null references public.case_visits (id) on delete cascade,
  view_type_id uuid not null references public.image_view_types (id) on delete restrict,
  availability_status text not null default 'MISSING',
  current_version_id uuid,
  not_available_reason text,
  not_available_by uuid references public.profiles (id) on delete set null,
  not_available_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_images_status_allowed
    check (availability_status in ('UPLOADED', 'MISSING', 'NOT_AVAILABLE')),
  constraint clinical_images_reason_length
    check (not_available_reason is null or length(not_available_reason) <= 500),
  constraint clinical_images_uploaded_requires_version
    check (availability_status <> 'UPLOADED' or current_version_id is not null),
  constraint clinical_images_unique_slot unique (visit_id, view_type_id)
);

create index if not exists clinical_images_case_id_idx on public.clinical_images (case_id);
create index if not exists clinical_images_visit_id_idx on public.clinical_images (visit_id);
create index if not exists clinical_images_status_idx on public.clinical_images (availability_status);

drop trigger if exists clinical_images_set_updated_at on public.clinical_images;
create trigger clinical_images_set_updated_at
  before update on public.clinical_images
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- clinical_image_versions — immutable. One row per uploaded object.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_image_versions (
  id uuid primary key default gen_random_uuid(),
  clinical_image_id uuid not null references public.clinical_images (id) on delete cascade,
  bucket text not null,
  object_key text not null unique,
  original_filename text,
  mime_type text not null,
  file_size bigint not null,
  sha256 text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references public.profiles (id) on delete set null,
  constraint clinical_image_versions_size_positive check (file_size > 0),
  constraint clinical_image_versions_mime_allowed
    check (mime_type in ('image/jpeg', 'image/png'))
);

create index if not exists clinical_image_versions_image_idx
  on public.clinical_image_versions (clinical_image_id, uploaded_at desc);

alter table public.clinical_images
  drop constraint if exists clinical_images_current_version_fk;
alter table public.clinical_images
  add constraint clinical_images_current_version_fk
  foreign key (current_version_id) references public.clinical_image_versions (id)
  on delete restrict
  deferrable initially deferred;

-- Version rows are historical facts: block mutation of the immutable columns.
create or replace function public.clinical_image_versions_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'clinical image versions cannot be deleted';
  end if;

  if new.object_key is distinct from old.object_key
     or new.bucket is distinct from old.bucket
     or new.clinical_image_id is distinct from old.clinical_image_id
     or new.file_size is distinct from old.file_size
     or new.sha256 is distinct from old.sha256
     or new.mime_type is distinct from old.mime_type
     or new.uploaded_at is distinct from old.uploaded_at
     or new.uploaded_by is distinct from old.uploaded_by then
    raise exception 'clinical image version records are immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists clinical_image_versions_immutable on public.clinical_image_versions;
create trigger clinical_image_versions_immutable
  before update or delete on public.clinical_image_versions
  for each row execute function public.clinical_image_versions_guard();

-- ---------------------------------------------------------------------------
-- image_upload_sessions — idempotency + orphan cleanup for direct uploads.
-- ---------------------------------------------------------------------------
create table if not exists public.image_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  visit_id uuid not null references public.case_visits (id) on delete cascade,
  view_type_id uuid not null references public.image_view_types (id) on delete restrict,
  bucket text not null,
  object_key text not null unique,
  expected_mime_type text not null,
  expected_file_size bigint not null,
  original_filename text,
  status text not null default 'PENDING',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  clinical_image_version_id uuid references public.clinical_image_versions (id) on delete set null,
  constraint image_upload_sessions_status_allowed
    check (status in ('PENDING', 'FINALIZED', 'ABANDONED'))
);

create index if not exists image_upload_sessions_case_idx on public.image_upload_sessions (case_id);
create index if not exists image_upload_sessions_status_idx
  on public.image_upload_sessions (status, expires_at);

-- ---------------------------------------------------------------------------
-- finalize_image_upload — atomic: version insert + slot pointer + supersede +
-- audit. Idempotent on the upload session.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_image_upload(
  p_session_id uuid,
  p_file_size bigint,
  p_sha256 text,
  p_actor uuid default auth.uid()
)
returns public.clinical_image_versions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.image_upload_sessions;
  v_image public.clinical_images;
  v_previous public.clinical_image_versions;
  v_version public.clinical_image_versions;
  v_is_replacement boolean := false;
begin
  select * into v_session
  from public.image_upload_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'upload session not found' using errcode = 'P0002';
  end if;

  -- Idempotency: a retried finalize returns the version already created.
  if v_session.status = 'FINALIZED' then
    select * into v_version
    from public.clinical_image_versions
    where id = v_session.clinical_image_version_id;
    return v_version;
  end if;

  if v_session.status <> 'PENDING' then
    raise exception 'upload session is not pending' using errcode = '22023';
  end if;

  -- Claim (or create) the logical slot for this visit/view pair.
  select * into v_image
  from public.clinical_images
  where visit_id = v_session.visit_id
    and view_type_id = v_session.view_type_id
  for update;

  if not found then
    insert into public.clinical_images (case_id, visit_id, view_type_id, availability_status)
    values (v_session.case_id, v_session.visit_id, v_session.view_type_id, 'MISSING')
    returning * into v_image;
  end if;

  if v_image.current_version_id is not null then
    v_is_replacement := true;
    select * into v_previous
    from public.clinical_image_versions
    where id = v_image.current_version_id;
  end if;

  insert into public.clinical_image_versions (
    clinical_image_id, bucket, object_key, original_filename,
    mime_type, file_size, sha256, uploaded_by
  )
  values (
    v_image.id, v_session.bucket, v_session.object_key, v_session.original_filename,
    v_session.expected_mime_type, p_file_size, p_sha256, p_actor
  )
  returning * into v_version;

  if v_is_replacement then
    update public.clinical_image_versions
    set superseded_at = now(), superseded_by = p_actor
    where id = v_previous.id;
  end if;

  update public.clinical_images
  set current_version_id = v_version.id,
      availability_status = 'UPLOADED',
      not_available_reason = null,
      not_available_by = null,
      not_available_at = null
  where id = v_image.id;

  update public.image_upload_sessions
  set status = 'FINALIZED',
      finalized_at = now(),
      clinical_image_version_id = v_version.id
  where id = v_session.id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor,
    case when v_is_replacement then 'IMAGE_REPLACED' else 'IMAGE_UPLOADED' end,
    'clinical_image',
    v_image.id,
    v_session.case_id,
    jsonb_build_object(
      'visit_id', v_session.visit_id,
      'view_type_id', v_session.view_type_id,
      'version_id', v_version.id,
      'file_size', p_file_size,
      'mime_type', v_session.expected_mime_type,
      'superseded_version_id', v_previous.id
    )
  );

  return v_version;
end;
$$;

revoke all on function public.finalize_image_upload(uuid, bigint, text, uuid) from public;
grant execute on function public.finalize_image_upload(uuid, bigint, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- mark_image_unavailable — records a genuine "no image exists" state.
-- ---------------------------------------------------------------------------
create or replace function public.mark_image_unavailable(
  p_visit_id uuid,
  p_view_type_id uuid,
  p_reason text,
  p_actor uuid default auth.uid()
)
returns public.clinical_images
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_case_id uuid;
  v_image public.clinical_images;
begin
  select case_id into v_case_id from public.case_visits where id = p_visit_id;
  if v_case_id is null then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;

  insert into public.clinical_images (
    case_id, visit_id, view_type_id, availability_status,
    not_available_reason, not_available_by, not_available_at
  )
  values (
    v_case_id, p_visit_id, p_view_type_id, 'NOT_AVAILABLE',
    nullif(btrim(coalesce(p_reason, '')), ''), p_actor, now()
  )
  on conflict (visit_id, view_type_id) do update
  set availability_status = 'NOT_AVAILABLE',
      not_available_reason = nullif(btrim(coalesce(excluded.not_available_reason, '')), ''),
      not_available_by = excluded.not_available_by,
      not_available_at = now()
  returning * into v_image;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor, 'IMAGE_MARKED_NOT_AVAILABLE', 'clinical_image', v_image.id, v_case_id,
    jsonb_build_object(
      'visit_id', p_visit_id,
      'view_type_id', p_view_type_id,
      'reason', v_image.not_available_reason
    )
  );

  return v_image;
end;
$$;

revoke all on function public.mark_image_unavailable(uuid, uuid, text, uuid) from public;
grant execute on function public.mark_image_unavailable(uuid, uuid, text, uuid) to service_role;
