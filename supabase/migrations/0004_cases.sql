-- AURA Clinical Data Library
-- 0003: cases, case numbering, visits, tags.

-- ---------------------------------------------------------------------------
-- Concurrency-safe case numbering.
--
-- A PostgreSQL sequence guarantees uniqueness under concurrent inserts without
-- the application ever computing MAX(case_number) + 1.
-- ---------------------------------------------------------------------------
create sequence if not exists public.case_number_seq as bigint start with 1 increment by 1;

create table if not exists public.case_number_config (
  id boolean primary key default true,
  prefix text not null default 'RH-',
  padding integer not null default 4,
  updated_at timestamptz not null default now(),
  constraint case_number_config_singleton check (id),
  constraint case_number_config_padding_range check (padding between 1 and 12)
);

insert into public.case_number_config (id) values (true) on conflict (id) do nothing;

create or replace function public.format_case_number(seq bigint)
returns text
language sql
stable
as $$
  select cfg.prefix || lpad(seq::text, greatest(cfg.padding, length(seq::text)), '0')
  from public.case_number_config cfg
  where cfg.id;
$$;

create or replace function public.next_case_number()
returns text
language sql
volatile
as $$
  select public.format_case_number(nextval('public.case_number_seq'));
$$;

-- ---------------------------------------------------------------------------
-- cases
-- ---------------------------------------------------------------------------
create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  procedure_id uuid not null references public.procedures (id) on delete restrict,
  procedure_type_id uuid not null references public.procedure_types (id) on delete restrict,
  surgery_date date not null,
  status text not null default 'ACTIVE',
  followup_availability text,
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint cases_status_allowed check (status in ('ACTIVE', 'COMPLETED', 'ARCHIVED')),
  constraint cases_archived_consistency check (
    (status = 'ARCHIVED' and archived_at is not null)
    or (status <> 'ARCHIVED' and archived_at is null)
  )
);

create index if not exists cases_case_number_idx on public.cases (case_number);
create index if not exists cases_case_number_trgm on public.cases using gin (case_number gin_trgm_ops);
create index if not exists cases_procedure_id_idx on public.cases (procedure_id);
create index if not exists cases_procedure_type_id_idx on public.cases (procedure_type_id);
create index if not exists cases_surgery_date_idx on public.cases (surgery_date desc);
create index if not exists cases_status_idx on public.cases (status);
create index if not exists cases_created_at_idx on public.cases (created_at desc);

drop trigger if exists cases_set_updated_at on public.cases;
create trigger cases_set_updated_at
  before update on public.cases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- case_tags (join to clinical_tags)
-- ---------------------------------------------------------------------------
create table if not exists public.case_tags (
  case_id uuid not null references public.cases (id) on delete cascade,
  tag_id uuid not null references public.clinical_tags (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (case_id, tag_id)
);

create index if not exists case_tags_tag_id_idx on public.case_tags (tag_id);

-- ---------------------------------------------------------------------------
-- case_visits
-- ---------------------------------------------------------------------------
create table if not exists public.case_visits (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  visit_type text not null,
  visit_date date,
  display_label text not null,
  months_after_surgery numeric(6, 2),
  clinical_observation text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_visits_type_allowed check (visit_type in ('BEFORE', 'FOLLOW_UP')),
  constraint case_visits_label_not_blank check (btrim(display_label) <> ''),
  constraint case_visits_followup_requires_date check (
    visit_type <> 'FOLLOW_UP' or visit_date is not null
  ),
  constraint case_visits_observation_length check (
    clinical_observation is null or length(clinical_observation) <= 10000
  )
);

-- Only one BEFORE visit per case (MVP rule).
create unique index if not exists case_visits_one_before_per_case
  on public.case_visits (case_id)
  where visit_type = 'BEFORE';

create index if not exists case_visits_case_id_idx on public.case_visits (case_id);
create index if not exists case_visits_visit_date_idx on public.case_visits (case_id, visit_date);

drop trigger if exists case_visits_set_updated_at on public.case_visits;
create trigger case_visits_set_updated_at
  before update on public.case_visits
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Atomic case creation: number generation + insert + BEFORE visit + audit,
-- all in one transaction.
-- ---------------------------------------------------------------------------
create or replace function public.create_case(
  p_procedure_id uuid,
  p_procedure_type_id uuid,
  p_surgery_date date,
  p_followup_availability text default null,
  p_tag_ids uuid[] default '{}',
  p_actor uuid default auth.uid()
)
returns public.cases
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.cases;
  v_number text;
  v_tag uuid;
begin
  v_number := public.next_case_number();

  insert into public.cases (
    case_number, procedure_id, procedure_type_id, surgery_date,
    followup_availability, created_by
  )
  values (
    v_number, p_procedure_id, p_procedure_type_id, p_surgery_date,
    nullif(btrim(coalesce(p_followup_availability, '')), ''), p_actor
  )
  returning * into v_case;

  -- The BEFORE visit always exists for a case; its image slots are created
  -- lazily as they are uploaded or marked unavailable.
  insert into public.case_visits (case_id, visit_type, display_label, visit_date, created_by)
  values (v_case.id, 'BEFORE', 'Before', p_surgery_date, p_actor);

  foreach v_tag in array coalesce(p_tag_ids, '{}')
  loop
    insert into public.case_tags (case_id, tag_id, created_by)
    values (v_case.id, v_tag, p_actor)
    on conflict do nothing;
  end loop;

  update public.procedures set usage_count = usage_count + 1 where id = p_procedure_id;
  update public.procedure_types set usage_count = usage_count + 1 where id = p_procedure_type_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor, 'CASE_CREATED', 'case', v_case.id, v_case.id,
    jsonb_build_object(
      'case_number', v_case.case_number,
      'procedure_id', p_procedure_id,
      'procedure_type_id', p_procedure_type_id,
      'surgery_date', p_surgery_date
    )
  );

  return v_case;
end;
$$;

revoke all on function public.create_case(uuid, uuid, date, text, uuid[], uuid) from public;
grant execute on function public.create_case(uuid, uuid, date, text, uuid[], uuid) to service_role;
