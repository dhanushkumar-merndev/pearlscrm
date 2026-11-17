-- Pearl Aesthetic Clinic Library
-- 0031: branches, patients with branch File IDs, consultations (first visit),
-- doctor notes, and prescription documents.
--
-- This is the deliberate privacy change requested by the clinic: the library
-- now holds a minimal patient identity (name, phone, age, sex). It is kept out
-- of object keys, URLs, page titles, logs, audit metadata and push text — the
-- visible identifier everywhere else is the File ID (BG0001, KL0001, …).
--
-- Who can read patients: active ADMIN and DOCTOR users, at every branch. That
-- is what lets a doctor at any branch type a File ID and see the full history.
-- VIEWER never reads patient identity. All writes go through the
-- service-role RPCs below, which re-check the actor.

begin;

-- ---------------------------------------------------------------------------
-- 1. Branches and per-branch File ID counters
-- ---------------------------------------------------------------------------
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branches_code_format check (code ~ '^[A-Z]{2,4}$'),
  constraint branches_name_length check (char_length(btrim(name)) between 1 and 120)
);

drop trigger if exists branches_set_updated_at on public.branches;
create trigger branches_set_updated_at before update on public.branches
  for each row execute function public.set_updated_at();

-- One counter row per branch. `next_file_id` increments it with a row lock,
-- so two receptionists registering at once can never get the same number,
-- and the application never computes MAX(file_id) + 1.
create table if not exists public.branch_file_counters (
  branch_id uuid primary key references public.branches (id) on delete restrict,
  last_value integer not null default 0,
  constraint branch_file_counters_non_negative check (last_value >= 0)
);

create or replace function public.branches_create_counter()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.branch_file_counters (branch_id) values (new.id)
  on conflict (branch_id) do nothing;
  return new;
end;
$$;

drop trigger if exists branches_create_counter on public.branches;
create trigger branches_create_counter after insert on public.branches
  for each row execute function public.branches_create_counter();

insert into public.branches (code, name, sort_order) values
  ('BG', 'Brigade Road', 1),
  ('KL', 'Koramangala', 2),
  ('SH', 'Sahakara Nagar', 3)
on conflict (code) do nothing;

insert into public.branch_file_counters (branch_id)
select id from public.branches
on conflict (branch_id) do nothing;

create or replace function public.format_file_id(p_code text, p_seq integer)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_code || lpad(p_seq::text, greatest(4, length(p_seq::text)), '0');
$$;

create or replace function public.next_file_id(p_branch_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_seq integer;
begin
  select code into v_code from public.branches where id = p_branch_id and is_active;
  if v_code is null then
    raise exception 'Branch is not available' using errcode = 'P0002';
  end if;

  update public.branch_file_counters
  set last_value = last_value + 1
  where branch_id = p_branch_id
  returning last_value into v_seq;

  return public.format_file_id(v_code, v_seq);
end;
$$;

-- A branch code is printed on patient files. Once a patient carries it,
-- renaming the code would orphan those File IDs, so it is frozen.
create or replace function public.branches_freeze_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.code is distinct from old.code
     and exists (select 1 from public.branch_file_counters c where c.branch_id = old.id and c.last_value > 0) then
    raise exception 'The branch code is already used in File IDs and cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists branches_freeze_code on public.branches;
create trigger branches_freeze_code before update on public.branches
  for each row execute function public.branches_freeze_code();

-- A user's home branch: used to default the branch on new patients and to
-- decide who counts as "branch staff" for surgery reminders.
alter table public.profiles
  add column if not exists branch_id uuid references public.branches (id) on delete set null;

create index if not exists profiles_branch_idx on public.profiles (branch_id);

-- ---------------------------------------------------------------------------
-- 2. Patients
-- ---------------------------------------------------------------------------
create or replace function public.can_read_patients()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user() and public.current_role_code() in ('ADMIN', 'DOCTOR');
$$;

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  file_id text not null unique,
  branch_id uuid not null references public.branches (id) on delete restrict,
  full_name text not null,
  phone text,
  sex text,
  age_years smallint,
  age_recorded_on date,
  referred_by_id uuid references public.profiles (id) on delete set null,
  referral_source text,
  referred_for_procedure_id uuid references public.procedures (id) on delete restrict,
  referral_note text,
  first_visit_date date,
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint patients_file_id_format check (file_id ~ '^[A-Z]{2,4}[0-9]{4,}$'),
  constraint patients_full_name_length check (char_length(btrim(full_name)) between 1 and 200),
  constraint patients_phone_format check (phone is null or phone ~ '^[0-9+() -]{6,20}$'),
  constraint patients_sex_allowed check (sex is null or sex in ('FEMALE', 'MALE', 'OTHER')),
  constraint patients_age_range check (age_years is null or age_years between 0 and 120),
  constraint patients_age_recorded check (age_years is null or age_recorded_on is not null),
  constraint patients_referral_source_length check (referral_source is null or char_length(referral_source) <= 200),
  constraint patients_referral_note_length check (referral_note is null or char_length(referral_note) <= 1000)
);

create index if not exists patients_branch_idx on public.patients (branch_id);
create index if not exists patients_file_id_pattern_idx on public.patients (file_id text_pattern_ops);
create index if not exists patients_phone_idx on public.patients (phone);
create index if not exists patients_full_name_trgm_idx on public.patients using gin (full_name gin_trgm_ops);
create index if not exists patients_created_at_idx on public.patients (created_at desc);

drop trigger if exists patients_set_updated_at on public.patients;
create trigger patients_set_updated_at before update on public.patients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Consultations (first visit and later visits at the clinic)
-- ---------------------------------------------------------------------------
create table if not exists public.patient_consultations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  branch_id uuid not null references public.branches (id) on delete restrict,
  doctor_id uuid references public.profiles (id) on delete set null,
  visit_date date not null,
  is_first_visit boolean not null default false,
  notes text,
  next_visit_date date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_consultations_notes_length check (notes is null or char_length(notes) <= 10000),
  constraint patient_consultations_next_after_visit check (next_visit_date is null or next_visit_date >= visit_date)
);

create unique index if not exists patient_consultations_one_first_visit
  on public.patient_consultations (patient_id) where is_first_visit;
create index if not exists patient_consultations_patient_idx
  on public.patient_consultations (patient_id, visit_date desc);
create index if not exists patient_consultations_next_visit_idx
  on public.patient_consultations (next_visit_date) where next_visit_date is not null;

drop trigger if exists patient_consultations_set_updated_at on public.patient_consultations;
create trigger patient_consultations_set_updated_at before update on public.patient_consultations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Doctor notes (append-only comments, optional next visit)
-- ---------------------------------------------------------------------------
create table if not exists public.patient_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  case_id uuid references public.cases (id) on delete restrict,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null,
  next_visit_date date,
  created_at timestamptz not null default now(),
  constraint patient_notes_body_length check (char_length(btrim(body)) between 1 and 5000)
);

create index if not exists patient_notes_patient_idx on public.patient_notes (patient_id, created_at desc);
create index if not exists patient_notes_next_visit_idx
  on public.patient_notes (next_visit_date) where next_visit_date is not null;

create or replace function public.patient_notes_block_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Doctor notes are append-only; add a new note instead' using errcode = '42501';
end;
$$;

drop trigger if exists patient_notes_immutable on public.patient_notes;
create trigger patient_notes_immutable before update or delete on public.patient_notes
  for each row execute function public.patient_notes_block_mutation();

-- ---------------------------------------------------------------------------
-- 5. Prescription documents (immutable originals in private Tigris)
-- ---------------------------------------------------------------------------
create table if not exists public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  consultation_id uuid references public.patient_consultations (id) on delete set null,
  kind text not null default 'PRESCRIPTION',
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
  constraint patient_documents_kind_allowed check (kind in ('PRESCRIPTION', 'OTHER')),
  constraint patient_documents_mime_allowed check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  constraint patient_documents_size_positive check (file_size > 0),
  constraint patient_documents_sha256_format check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint patient_documents_filename_length check (original_filename is null or char_length(original_filename) <= 255)
);

create index if not exists patient_documents_patient_idx on public.patient_documents (patient_id, uploaded_at desc);

create or replace function public.patient_documents_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Patient documents cannot be deleted' using errcode = '42501';
  end if;
  -- Only the supersede markers may be set, once.
  if (new.id, new.patient_id, new.consultation_id, new.kind, new.bucket, new.object_key,
      new.original_filename, new.mime_type, new.file_size, new.sha256, new.uploaded_by, new.uploaded_at)
     is distinct from
     (old.id, old.patient_id, old.consultation_id, old.kind, old.bucket, old.object_key,
      old.original_filename, old.mime_type, old.file_size, old.sha256, old.uploaded_by, old.uploaded_at)
     or old.superseded_at is not null then
    raise exception 'Patient documents are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists patient_documents_immutable on public.patient_documents;
create trigger patient_documents_immutable before update or delete on public.patient_documents
  for each row execute function public.patient_documents_guard();

create table if not exists public.document_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  consultation_id uuid references public.patient_consultations (id) on delete set null,
  kind text not null default 'PRESCRIPTION',
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
  document_id uuid references public.patient_documents (id) on delete set null,
  constraint document_upload_sessions_status_allowed check (status in ('PENDING', 'FINALIZED', 'ABANDONED')),
  constraint document_upload_sessions_kind_allowed check (kind in ('PRESCRIPTION', 'OTHER'))
);

create index if not exists document_upload_sessions_status_idx
  on public.document_upload_sessions (status, expires_at);

-- ---------------------------------------------------------------------------
-- 6. RLS — reads for active ADMIN/DOCTOR; no client writes at all
-- ---------------------------------------------------------------------------
alter table public.branches enable row level security;
alter table public.branches force row level security;
alter table public.branch_file_counters enable row level security;
alter table public.branch_file_counters force row level security;
alter table public.patients enable row level security;
alter table public.patients force row level security;
alter table public.patient_consultations enable row level security;
alter table public.patient_consultations force row level security;
alter table public.patient_notes enable row level security;
alter table public.patient_notes force row level security;
alter table public.patient_documents enable row level security;
alter table public.patient_documents force row level security;
alter table public.document_upload_sessions enable row level security;
alter table public.document_upload_sessions force row level security;

drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches
  for select to authenticated using (public.is_active_user());

drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients
  for select to authenticated using (public.can_read_patients());

drop policy if exists patient_consultations_select on public.patient_consultations;
create policy patient_consultations_select on public.patient_consultations
  for select to authenticated using (public.can_read_patients());

drop policy if exists patient_notes_select on public.patient_notes;
create policy patient_notes_select on public.patient_notes
  for select to authenticated using (public.can_read_patients());

drop policy if exists patient_documents_select on public.patient_documents;
create policy patient_documents_select on public.patient_documents
  for select to authenticated using (public.can_read_patients());

-- branch_file_counters and document_upload_sessions: no policies (service role only).

-- ---------------------------------------------------------------------------
-- 7. RPCs (service role only; each re-checks the actor)
-- ---------------------------------------------------------------------------
create or replace function public.assert_patient_writer(p_actor uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = p_actor and p.is_active and r.code in ('ADMIN', 'DOCTOR')
  ) then
    raise exception 'Not allowed to change patient records' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_patient(
  p_branch_id uuid,
  p_full_name text,
  p_phone text,
  p_sex text,
  p_age_years smallint,
  p_referred_by_id uuid,
  p_referral_source text,
  p_referred_for_procedure_id uuid,
  p_referral_note text,
  p_first_visit_date date,
  p_consultation_notes text,
  p_next_visit_date date,
  p_actor uuid
)
returns public.patients
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient public.patients;
  v_file_id text;
begin
  perform public.assert_patient_writer(p_actor);

  if p_referred_by_id is not null and not exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = p_referred_by_id and r.code in ('ADMIN', 'DOCTOR')
  ) then
    raise exception 'The referring doctor was not found' using errcode = '22023';
  end if;

  v_file_id := public.next_file_id(p_branch_id);

  insert into public.patients (
    file_id, branch_id, full_name, phone, sex, age_years, age_recorded_on,
    referred_by_id, referral_source, referred_for_procedure_id, referral_note,
    first_visit_date, created_by
  ) values (
    v_file_id, p_branch_id,
    regexp_replace(btrim(p_full_name), '\s+', ' ', 'g'),
    nullif(btrim(coalesce(p_phone, '')), ''),
    p_sex, p_age_years,
    case when p_age_years is null then null else coalesce(p_first_visit_date, current_date) end,
    p_referred_by_id,
    nullif(btrim(coalesce(p_referral_source, '')), ''),
    p_referred_for_procedure_id,
    nullif(btrim(coalesce(p_referral_note, '')), ''),
    p_first_visit_date, p_actor
  )
  returning * into v_patient;

  if p_first_visit_date is not null then
    insert into public.patient_consultations (
      patient_id, branch_id, doctor_id, visit_date, is_first_visit, notes, next_visit_date, created_by
    ) values (
      v_patient.id, p_branch_id, p_actor, p_first_visit_date, true,
      nullif(btrim(coalesce(p_consultation_notes, '')), ''), p_next_visit_date, p_actor
    );
  end if;

  if p_referred_for_procedure_id is not null then
    update public.procedures set usage_count = usage_count + 1 where id = p_referred_for_procedure_id;
  end if;

  -- File ID and branch only: never the name or phone.
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor, 'PATIENT_CREATED', 'patient', v_patient.id, null,
    jsonb_build_object('file_id', v_patient.file_id, 'branch_id', p_branch_id,
                       'has_referral', p_referred_by_id is not null or p_referral_source is not null)
  );

  return v_patient;
end;
$$;

create or replace function public.update_patient(
  p_patient_id uuid,
  p_expected_version integer,
  p_full_name text,
  p_phone text,
  p_sex text,
  p_age_years smallint,
  p_referred_by_id uuid,
  p_referral_source text,
  p_referred_for_procedure_id uuid,
  p_referral_note text,
  p_actor uuid
)
returns public.patients
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.patients;
  v_new public.patients;
  v_changed text[] := '{}';
begin
  perform public.assert_patient_writer(p_actor);

  select * into v_old from public.patients where id = p_patient_id for update;
  if not found then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'This patient was changed by someone else. Reload to see the latest details.'
      using errcode = '40001';
  end if;

  update public.patients set
    full_name = regexp_replace(btrim(p_full_name), '\s+', ' ', 'g'),
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    sex = p_sex,
    age_years = p_age_years,
    age_recorded_on = case
      when p_age_years is null then null
      when p_age_years is distinct from v_old.age_years then current_date
      else v_old.age_recorded_on end,
    referred_by_id = p_referred_by_id,
    referral_source = nullif(btrim(coalesce(p_referral_source, '')), ''),
    referred_for_procedure_id = p_referred_for_procedure_id,
    referral_note = nullif(btrim(coalesce(p_referral_note, '')), ''),
    version = version + 1
  where id = p_patient_id
  returning * into v_new;

  if v_new.full_name is distinct from v_old.full_name then v_changed := v_changed || 'full_name'; end if;
  if v_new.phone is distinct from v_old.phone then v_changed := v_changed || 'phone'; end if;
  if v_new.sex is distinct from v_old.sex then v_changed := v_changed || 'sex'; end if;
  if v_new.age_years is distinct from v_old.age_years then v_changed := v_changed || 'age_years'; end if;
  if v_new.referred_by_id is distinct from v_old.referred_by_id then v_changed := v_changed || 'referred_by_id'; end if;
  if v_new.referral_source is distinct from v_old.referral_source then v_changed := v_changed || 'referral_source'; end if;
  if v_new.referred_for_procedure_id is distinct from v_old.referred_for_procedure_id then v_changed := v_changed || 'referred_for_procedure_id'; end if;
  if v_new.referral_note is distinct from v_old.referral_note then v_changed := v_changed || 'referral_note'; end if;

  if cardinality(v_changed) > 0 then
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
    values (p_actor, 'PATIENT_UPDATED', 'patient', p_patient_id, null,
            jsonb_build_object('file_id', v_new.file_id, 'changed_fields', to_jsonb(v_changed)));
  end if;

  return v_new;
end;
$$;

create or replace function public.record_consultation(
  p_patient_id uuid,
  p_branch_id uuid,
  p_visit_date date,
  p_notes text,
  p_next_visit_date date,
  p_actor uuid
)
returns public.patient_consultations
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.patient_consultations;
  v_first boolean;
begin
  perform public.assert_patient_writer(p_actor);

  if not exists (select 1 from public.patients where id = p_patient_id and archived_at is null) then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;

  v_first := not exists (select 1 from public.patient_consultations where patient_id = p_patient_id);

  insert into public.patient_consultations (
    patient_id, branch_id, doctor_id, visit_date, is_first_visit, notes, next_visit_date, created_by
  ) values (
    p_patient_id, p_branch_id, p_actor, p_visit_date, v_first,
    nullif(btrim(coalesce(p_notes, '')), ''), p_next_visit_date, p_actor
  )
  returning * into v_row;

  if v_first then
    update public.patients set first_visit_date = coalesce(first_visit_date, p_visit_date) where id = p_patient_id;
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (p_actor, 'CONSULTATION_RECORDED', 'patient_consultation', v_row.id, null,
          jsonb_build_object('patient_id', p_patient_id, 'branch_id', p_branch_id,
                             'visit_date', p_visit_date, 'is_first_visit', v_first,
                             'next_visit_date', p_next_visit_date));

  return v_row;
end;
$$;

create or replace function public.add_patient_note(
  p_patient_id uuid,
  p_case_id uuid,
  p_body text,
  p_next_visit_date date,
  p_actor uuid
)
returns public.patient_notes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.patient_notes;
begin
  perform public.assert_patient_writer(p_actor);

  if not exists (select 1 from public.patients where id = p_patient_id) then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;

  insert into public.patient_notes (patient_id, case_id, author_id, body, next_visit_date)
  values (p_patient_id, p_case_id, p_actor, btrim(p_body), p_next_visit_date)
  returning * into v_row;

  -- The note body is clinical free text and is never copied into the audit log.
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (p_actor, 'PATIENT_NOTE_ADDED', 'patient_note', v_row.id, p_case_id,
          jsonb_build_object('patient_id', p_patient_id, 'next_visit_date', p_next_visit_date,
                             'length', char_length(v_row.body)));

  return v_row;
end;
$$;

create or replace function public.finalize_document_upload(
  p_session_id uuid,
  p_file_size bigint,
  p_sha256 text,
  p_actor uuid
)
returns public.patient_documents
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.document_upload_sessions;
  v_doc public.patient_documents;
begin
  perform public.assert_patient_writer(p_actor);

  select * into v_session from public.document_upload_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Upload session not found' using errcode = 'P0002';
  end if;
  if v_session.created_by is distinct from p_actor then
    raise exception 'This upload belongs to another user' using errcode = '42501';
  end if;

  -- Idempotent: a retried finalize returns the document already recorded.
  if v_session.status = 'FINALIZED' then
    select * into v_doc from public.patient_documents where id = v_session.document_id;
    return v_doc;
  end if;
  if v_session.status <> 'PENDING' then
    raise exception 'This upload was abandoned' using errcode = '22023';
  end if;
  if p_file_size <> v_session.expected_file_size then
    raise exception 'Uploaded file size does not match' using errcode = '22023';
  end if;

  insert into public.patient_documents (
    patient_id, consultation_id, kind, bucket, object_key, original_filename,
    mime_type, file_size, sha256, uploaded_by
  ) values (
    v_session.patient_id, v_session.consultation_id, v_session.kind, v_session.bucket,
    v_session.object_key, v_session.original_filename, v_session.expected_mime_type,
    p_file_size, p_sha256, p_actor
  )
  returning * into v_doc;

  update public.document_upload_sessions
  set status = 'FINALIZED', finalized_at = now(), document_id = v_doc.id
  where id = p_session_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (p_actor, 'PRESCRIPTION_UPLOADED', 'patient_document', v_doc.id, null,
          jsonb_build_object('patient_id', v_doc.patient_id, 'kind', v_doc.kind,
                             'mime_type', v_doc.mime_type, 'file_size', v_doc.file_size));

  return v_doc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'public.next_file_id(uuid)',
    'public.branches_create_counter()',
    'public.assert_patient_writer(uuid)',
    'public.create_patient(uuid, text, text, text, smallint, uuid, text, uuid, text, date, text, date, uuid)',
    'public.update_patient(uuid, integer, text, text, text, smallint, uuid, text, uuid, text, uuid)',
    'public.record_consultation(uuid, uuid, date, text, date, uuid)',
    'public.add_patient_note(uuid, uuid, text, date, uuid)',
    'public.finalize_document_upload(uuid, bigint, text, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated;', sig);
    execute format('grant execute on function %s to service_role;', sig);
  end loop;
end;
$$;

revoke all on function public.can_read_patients() from public, anon;
grant execute on function public.can_read_patients() to authenticated, service_role;
grant execute on function public.format_file_id(text, integer) to authenticated, service_role;

commit;
