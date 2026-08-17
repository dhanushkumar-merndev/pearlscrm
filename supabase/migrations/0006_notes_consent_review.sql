-- AURA Clinical Data Library
-- 0006: structured case notes, changes performed, consent, expert review.

-- ---------------------------------------------------------------------------
-- case_notes — one structured record per case, optimistically concurrent.
-- ---------------------------------------------------------------------------
create table if not exists public.case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.cases (id) on delete cascade,
  patient_concern text,
  preop_assessment text,
  treatment_recommendation text,
  preop_aesthetic_goal text,
  dorsum text,
  tip text,
  projection text,
  rotation text,
  alar text,
  septum text,
  other_anatomical_change text,
  surgeon_assessment text,
  outcome text,
  patient_satisfaction text,
  complications_present boolean,
  complication_type_id uuid references public.complication_types (id) on delete set null,
  complication_details text,
  revision_required boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  version integer not null default 1
);

-- Narrative fields are long-form but must stay bounded.
do $$
declare
  col text;
begin
  foreach col in array array[
    'patient_concern', 'preop_assessment', 'treatment_recommendation',
    'preop_aesthetic_goal', 'dorsum', 'tip', 'projection', 'rotation',
    'alar', 'septum', 'other_anatomical_change', 'surgeon_assessment',
    'outcome', 'patient_satisfaction', 'complication_details'
  ]
  loop
    execute format(
      'alter table public.case_notes drop constraint if exists case_notes_%1$s_length;
       alter table public.case_notes add constraint case_notes_%1$s_length
       check (%1$I is null or length(%1$I) <= 20000);',
      col
    );
  end loop;
end;
$$;

drop trigger if exists case_notes_set_updated_at on public.case_notes;
create trigger case_notes_set_updated_at
  before update on public.case_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- case_changes_performed — ordered repeatable list.
-- ---------------------------------------------------------------------------
create table if not exists public.case_changes_performed (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  description text not null,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_changes_description_not_blank check (btrim(description) <> ''),
  constraint case_changes_description_length check (length(description) <= 2000)
);

create index if not exists case_changes_case_id_idx
  on public.case_changes_performed (case_id, sort_order);

drop trigger if exists case_changes_set_updated_at on public.case_changes_performed;
create trigger case_changes_set_updated_at
  before update on public.case_changes_performed
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- case_consents — append-only history; latest row is the current consent.
-- Absence of any row means "not recorded", which is distinct from NO.
-- ---------------------------------------------------------------------------
create table if not exists public.case_consents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  image_use_consent boolean not null,
  notes text,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint case_consents_notes_length check (notes is null or length(notes) <= 2000)
);

create index if not exists case_consents_case_id_idx
  on public.case_consents (case_id, recorded_at desc);

create or replace function public.case_consents_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'consent history is append-only';
end;
$$;

drop trigger if exists case_consents_no_update on public.case_consents;
create trigger case_consents_no_update
  before update or delete on public.case_consents
  for each row execute function public.case_consents_block_mutation();

-- ---------------------------------------------------------------------------
-- case_reviews — one expert review record per case.
-- ---------------------------------------------------------------------------
create table if not exists public.case_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.cases (id) on delete cascade,
  status text not null default 'PENDING',
  final_assessment text,
  reviewer_id uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint case_reviews_status_allowed check (status in ('PENDING', 'IN_REVIEW', 'COMPLETED')),
  constraint case_reviews_completed_requires_assessment check (
    status <> 'COMPLETED'
    or (final_assessment is not null and btrim(final_assessment) <> '' and reviewed_at is not null)
  ),
  constraint case_reviews_assessment_length check (
    final_assessment is null or length(final_assessment) <= 20000
  )
);

create index if not exists case_reviews_status_idx on public.case_reviews (status);

drop trigger if exists case_reviews_set_updated_at on public.case_reviews;
create trigger case_reviews_set_updated_at
  before update on public.case_reviews
  for each row execute function public.set_updated_at();

-- Retain the history of every completed/edited assessment.
create table if not exists public.case_review_revisions (
  id uuid primary key default gen_random_uuid(),
  case_review_id uuid not null references public.case_reviews (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  status text not null,
  final_assessment text,
  reviewer_id uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now()
);

create index if not exists case_review_revisions_review_idx
  on public.case_review_revisions (case_review_id, recorded_at desc);

-- Every case gets its notes/review shells when it is created.
create or replace function public.cases_create_child_records()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.case_notes (case_id, updated_by) values (new.id, new.created_by)
  on conflict (case_id) do nothing;

  insert into public.case_reviews (case_id, status) values (new.id, 'PENDING')
  on conflict (case_id) do nothing;

  return new;
end;
$$;

drop trigger if exists cases_create_child_records_trg on public.cases;
create trigger cases_create_child_records_trg
  after insert on public.cases
  for each row execute function public.cases_create_child_records();
