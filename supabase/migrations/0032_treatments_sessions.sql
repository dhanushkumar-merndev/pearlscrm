-- Pearl Aesthetic Clinic Library
-- 0032: a case becomes a patient's *treatment*.
--
--   * cases gain patient_id, branch, treatment mode (SURGICAL | SESSIONS),
--     planned sessions and start date. Existing RH cases keep working with
--     patient_id null until an administrator links them.
--   * Case numbers take their prefix from the procedure (RH-, LHR-, …). RH-
--     keeps using the original case_number_seq so numbering never forks.
--   * SESSION visits, each with compulsory Before and After photos
--     (view types SESSION_BEFORE / SESSION_AFTER).
--   * Any active DOCTOR may READ every treatment linked to a patient (cross-
--     branch history). Write rules are unchanged: they now rest on
--     case_is_assigned(), which is exactly the old visibility rule.

begin;

-- ---------------------------------------------------------------------------
-- 1. Session photo view types
-- ---------------------------------------------------------------------------
alter table public.image_view_types
  add column if not exists applies_to text not null default 'CLINICAL';

alter table public.image_view_types drop constraint if exists image_view_types_applies_to_allowed;
alter table public.image_view_types
  add constraint image_view_types_applies_to_allowed check (applies_to in ('CLINICAL', 'SESSION'));

insert into public.image_view_types (code, display_name, sort_order, is_standard, is_active, applies_to)
values
  ('SESSION_BEFORE', 'Before treatment', 101, false, true, 'SESSION'),
  ('SESSION_AFTER', 'After treatment', 102, false, true, 'SESSION')
on conflict (code) do update
  set applies_to = 'SESSION', is_standard = false;

-- ---------------------------------------------------------------------------
-- 2. Procedure-level numbering prefix and default mode
-- ---------------------------------------------------------------------------
alter table public.procedures add column if not exists case_prefix text;
alter table public.procedures add column if not exists default_mode text;

alter table public.procedures drop constraint if exists procedures_case_prefix_format;
alter table public.procedures
  add constraint procedures_case_prefix_format check (case_prefix is null or case_prefix ~ '^[A-Z]{1,5}-$');
alter table public.procedures drop constraint if exists procedures_default_mode_allowed;
alter table public.procedures
  add constraint procedures_default_mode_allowed check (default_mode is null or default_mode in ('SURGICAL', 'SESSIONS'));

update public.procedures
set case_prefix = 'RH-', default_mode = 'SURGICAL'
where case_prefix is null
  and (normalized_key like '%rhinoplasty%' or normalized_key in ('septoplasty', 'alar base reduction', 'turbinate reduction'))
  and normalized_key not like 'non-surgical%';

update public.procedures
set default_mode = 'SESSIONS'
where default_mode is null
  and normalized_key ~ '(laser|lase |lase$|injection|filler|prp|booster|profhilo|morpheus|microneedl|wrinkle|lip flip|gummy smile|slimming|fotona|non-surgical|hair removal|peel|crow''s feet|frown lines|bunny lines|nasolabial|marionette|tear trough|acne|mesotherapy|tattoo|hydrafacial|scars? treatment|keratosis treatment|cellulite treatment|muscle relaxant|veins under the eyes|vaginal rejuvenation)';

-- The remaining catalogue is surgical. This is only the preselected default:
-- it is editable in Settings → Treatment numbering, and the clinician picks the
-- mode on every treatment. Procedures added later start unset.
update public.procedures set default_mode = 'SURGICAL' where default_mode is null;

create table if not exists public.case_number_counters (
  prefix text primary key,
  last_value bigint not null default 0,
  constraint case_number_counters_prefix_format check (prefix ~ '^[A-Z]{1,5}-$')
);

alter table public.case_number_counters enable row level security;
alter table public.case_number_counters force row level security;

create or replace function public.next_case_number_for(p_prefix text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg public.case_number_config;
  v_seq bigint;
begin
  select * into v_cfg from public.case_number_config where id;

  -- The original prefix stays on its sequence: one source of truth for RH-.
  if p_prefix = v_cfg.prefix then
    return public.next_case_number();
  end if;

  insert into public.case_number_counters (prefix, last_value) values (p_prefix, 1)
  on conflict (prefix) do update set last_value = public.case_number_counters.last_value + 1
  returning last_value into v_seq;

  return p_prefix || lpad(v_seq::text, greatest(v_cfg.padding, length(v_seq::text)), '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Cases become treatments
-- ---------------------------------------------------------------------------
alter table public.cases add column if not exists patient_id uuid references public.patients (id) on delete restrict;
alter table public.cases add column if not exists branch_id uuid references public.branches (id) on delete restrict;
alter table public.cases add column if not exists consultation_id uuid references public.patient_consultations (id) on delete set null;
alter table public.cases add column if not exists treatment_mode text not null default 'SURGICAL';
alter table public.cases add column if not exists planned_sessions integer;
alter table public.cases add column if not exists start_date date;
alter table public.cases add column if not exists surgeon_id uuid references public.profiles (id) on delete set null;
alter table public.cases add column if not exists surgery_marked_at timestamptz;
alter table public.cases add column if not exists surgery_marked_by uuid references public.profiles (id) on delete set null;

alter table public.cases alter column surgery_date drop not null;
alter table public.cases alter column procedure_type_id drop not null;

alter table public.cases drop constraint if exists cases_status_allowed;
alter table public.cases
  add constraint cases_status_allowed check (status in ('PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED'));

alter table public.cases drop constraint if exists cases_treatment_mode_allowed;
alter table public.cases
  add constraint cases_treatment_mode_allowed check (treatment_mode in ('SURGICAL', 'SESSIONS'));

-- A surgical treatment needs a type, and a date once it is past PLANNED.
alter table public.cases drop constraint if exists cases_surgical_fields;
alter table public.cases
  add constraint cases_surgical_fields check (
    treatment_mode <> 'SURGICAL'
    or (procedure_type_id is not null and (surgery_date is not null or status in ('PLANNED', 'ARCHIVED')))
  );

alter table public.cases drop constraint if exists cases_sessions_fields;
alter table public.cases
  add constraint cases_sessions_fields check (
    treatment_mode <> 'SESSIONS'
    or (planned_sessions between 1 and 100 and start_date is not null)
  );

create index if not exists cases_patient_idx on public.cases (patient_id);
create index if not exists cases_branch_idx on public.cases (branch_id);
create index if not exists cases_surgeon_idx on public.cases (surgeon_id);

-- ---------------------------------------------------------------------------
-- 4. Session visits
-- ---------------------------------------------------------------------------
alter table public.case_visits drop constraint if exists case_visits_type_allowed;
alter table public.case_visits
  add constraint case_visits_type_allowed check (visit_type in ('BEFORE', 'AFTER', 'FOLLOW_UP', 'SESSION'));

alter table public.case_visits add column if not exists session_number integer;
alter table public.case_visits add column if not exists session_status text;
alter table public.case_visits add column if not exists doctor_id uuid references public.profiles (id) on delete set null;
alter table public.case_visits add column if not exists next_visit_date date;
alter table public.case_visits add column if not exists completed_at timestamptz;
alter table public.case_visits add column if not exists completed_by uuid references public.profiles (id) on delete set null;

alter table public.case_visits drop constraint if exists case_visits_session_fields;
alter table public.case_visits
  add constraint case_visits_session_fields check (
    (visit_type = 'SESSION'
       and session_number >= 1 and visit_date is not null
       and session_status in ('SCHEDULED', 'COMPLETED')
       and ((session_status = 'COMPLETED') = (completed_at is not null)))
    or (visit_type <> 'SESSION' and session_number is null and session_status is null)
  );

create unique index if not exists case_visits_one_session_number
  on public.case_visits (case_id, session_number) where visit_type = 'SESSION';
create index if not exists case_visits_next_visit_idx
  on public.case_visits (next_visit_date) where next_visit_date is not null;

-- ---------------------------------------------------------------------------
-- 5. Access helpers: reads widen for doctors, writes do not
-- ---------------------------------------------------------------------------
-- The 0018 visibility rule, unchanged, under the name the write helpers use.
create or replace function public.case_is_assigned(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user()
    and (
      public.is_admin()
      or (
        public.current_role_code() = 'DOCTOR'
        and exists (
          select 1 from public.cases c
          where c.id = p_case_id
            and (
              c.created_by = auth.uid()
              or exists (select 1 from public.case_viewer_access a where a.case_id = c.id and a.user_id = auth.uid())
            )
        )
      )
      or (
        public.current_role_code() = 'VIEWER'
        and (
          exists (select 1 from public.profiles p where p.id = auth.uid() and p.case_visibility_scope = 'ALL')
          or exists (select 1 from public.case_viewer_access a where a.case_id = p_case_id and a.user_id = auth.uid())
        )
      )
    );
$$;

-- Reading: everything assigned, plus — for doctors — every treatment that
-- belongs to a patient, so the File ID lookup shows the full history.
create or replace function public.case_is_visible(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.case_is_assigned(p_case_id)
    or (
      public.is_active_user()
      and public.current_role_code() = 'DOCTOR'
      and exists (select 1 from public.cases c where c.id = p_case_id and c.patient_id is not null)
    );
$$;

create or replace function public.case_is_owned_or_admin(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin()
    or (public.current_role_code() = 'DOCTOR' and public.case_is_assigned(p_case_id));
$$;

create or replace function public.case_is_writable(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.case_is_assigned(p_case_id)
    and exists (
      select 1 from public.cases c
      where c.id = p_case_id and (c.archived_at is null or public.is_admin())
    );
$$;

-- The cases_update WITH CHECK used case_is_visible; tie it to assignment too.
drop policy if exists cases_update on public.cases;
create policy cases_update on public.cases
  for update to authenticated
  using (public.can_manage_cases() and public.case_is_writable(id))
  with check (public.can_manage_cases() and public.case_is_assigned(id));

-- Service-role RPCs run without auth.uid(); this is the same rule for an
-- explicit actor.
create or replace function public.actor_can_write_case(p_case_id uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    join public.cases c on c.id = p_case_id
    where p.id = p_actor
      and p.is_active
      and (
        r.code = 'ADMIN'
        or (
          r.code = 'DOCTOR'
          and c.archived_at is null
          and (
            c.created_by = p_actor
            or exists (select 1 from public.case_viewer_access a where a.case_id = c.id and a.user_id = p_actor)
          )
        )
      )
  );
$$;

revoke all on function public.case_is_assigned(uuid) from public, anon;
grant execute on function public.case_is_assigned(uuid) to authenticated, service_role;

-- 0013/0018 revoked these from PUBLIC only; Supabase grants anon separately,
-- so anon could still call them. They answer false for anon, but there is no
-- reason for an unauthenticated caller to reach them at all.
revoke all on function public.case_is_visible(uuid) from public, anon;
revoke all on function public.case_is_owned_or_admin(uuid) from public, anon;
revoke all on function public.case_is_writable(uuid) from public, anon;
grant execute on function public.case_is_visible(uuid) to authenticated, service_role;
grant execute on function public.case_is_owned_or_admin(uuid) to authenticated, service_role;
grant execute on function public.case_is_writable(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Review status counts the views that apply to the visit
-- ---------------------------------------------------------------------------
create or replace function public.visit_required_view_count(p_visit_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.image_view_types t
  where t.is_active
    and case
      when (select visit_type from public.case_visits where id = p_visit_id) = 'SESSION'
        then t.applies_to = 'SESSION'
      else t.is_standard
    end;
$$;

grant execute on function public.visit_required_view_count(uuid) to authenticated, service_role;

create or replace function public.visit_image_review_status(p_visit_id uuid)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with v as (
    select images_locked_at from public.case_visits where id = p_visit_id
  ),
  required as (
    select public.visit_required_view_count(p_visit_id) as n
  ),
  slots as (
    select
      count(*) filter (where availability_status in ('UPLOADED', 'NOT_AVAILABLE'))::int as resolved,
      count(*) filter (where review_status = 'APPROVED')::int as approved,
      count(*) filter (where review_status = 'REPHOTO_REQUESTED')::int as rejected
    from public.clinical_images
    where visit_id = p_visit_id
  )
  select case
    when (select images_locked_at from v) is null then 'NOT_SUBMITTED'
    when (select rejected from slots) > 0 then 'CHANGES_REQUESTED'
    when (select resolved from slots) >= (select n from required)
     and (select approved from slots) >= (select n from required) then 'APPROVED'
    else 'PENDING'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Treatment RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_treatment(
  p_patient_id uuid,
  p_branch_id uuid,
  p_procedure_id uuid,
  p_procedure_type_id uuid,
  p_mode text,
  p_planned_sessions integer,
  p_start_date date,
  p_surgery_date date,
  p_consultation_id uuid,
  p_followup_availability text,
  p_tag_ids uuid[],
  p_actor uuid
)
returns public.cases
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient public.patients;
  v_prefix text;
  v_case public.cases;
  v_tag uuid;
  v_status text;
begin
  perform public.assert_patient_writer(p_actor);

  select * into v_patient from public.patients where id = p_patient_id and archived_at is null;
  if not found then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;

  if p_mode not in ('SURGICAL', 'SESSIONS') then
    raise exception 'Unknown treatment mode' using errcode = '22023';
  end if;

  select coalesce(case_prefix, 'TX-') into v_prefix from public.procedures where id = p_procedure_id;
  if v_prefix is null then
    raise exception 'Procedure not found' using errcode = 'P0002';
  end if;

  v_status := case
    when p_mode = 'SURGICAL' and p_surgery_date is null then 'PLANNED'
    else 'ACTIVE'
  end;

  insert into public.cases (
    case_number, procedure_id, procedure_type_id, surgery_date, followup_availability,
    created_by, information_locked_at, patient_id, branch_id, consultation_id,
    treatment_mode, planned_sessions, start_date, status
  ) values (
    public.next_case_number_for(v_prefix), p_procedure_id,
    p_procedure_type_id,
    case when p_mode = 'SURGICAL' then p_surgery_date else null end,
    nullif(btrim(coalesce(p_followup_availability, '')), ''),
    p_actor, now(), p_patient_id, coalesce(p_branch_id, v_patient.branch_id), p_consultation_id,
    p_mode,
    case when p_mode = 'SESSIONS' then p_planned_sessions else null end,
    p_start_date,
    v_status
  )
  returning * into v_case;

  if p_mode = 'SURGICAL' then
    insert into public.case_visits (case_id, visit_type, display_label, visit_date, created_by)
    values
      (v_case.id, 'BEFORE', 'Before', p_surgery_date, p_actor),
      (v_case.id, 'AFTER', 'After', null, p_actor);
  end if;

  foreach v_tag in array coalesce(p_tag_ids, '{}')
  loop
    insert into public.case_tags (case_id, tag_id, created_by)
    values (v_case.id, v_tag, p_actor)
    on conflict do nothing;
  end loop;

  update public.procedures set usage_count = usage_count + 1 where id = p_procedure_id;
  if p_procedure_type_id is not null then
    update public.procedure_types set usage_count = usage_count + 1 where id = p_procedure_type_id;
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor, 'CASE_CREATED', 'case', v_case.id, v_case.id,
    jsonb_build_object(
      'case_number', v_case.case_number,
      'file_id', v_patient.file_id,
      'treatment_mode', p_mode,
      'procedure_id', p_procedure_id,
      'procedure_type_id', p_procedure_type_id,
      'surgery_date', p_surgery_date,
      'planned_sessions', v_case.planned_sessions,
      'start_date', v_case.start_date
    )
  );

  return v_case;
end;
$$;

create or replace function public.add_treatment_session(
  p_case_id uuid,
  p_visit_date date,
  p_doctor_id uuid,
  p_observation text,
  p_next_visit_date date,
  p_actor uuid
)
returns public.case_visits
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.cases;
  v_number integer;
  v_visit public.case_visits;
begin
  if not public.actor_can_write_case(p_case_id, p_actor) then
    raise exception 'You cannot add sessions to this treatment' using errcode = '42501';
  end if;

  -- Lock the treatment so two people adding a session at once get 3 and 4,
  -- not 3 and 3.
  select * into v_case from public.cases where id = p_case_id for update;
  if v_case.treatment_mode <> 'SESSIONS' then
    raise exception 'This treatment is not session-based' using errcode = '22023';
  end if;
  if v_case.status in ('ARCHIVED', 'COMPLETED') then
    raise exception 'This treatment is closed' using errcode = '22023';
  end if;

  select coalesce(max(session_number), 0) + 1 into v_number
  from public.case_visits where case_id = p_case_id and visit_type = 'SESSION';

  insert into public.case_visits (
    case_id, visit_type, visit_date, display_label, clinical_observation,
    session_number, session_status, doctor_id, next_visit_date, created_by
  ) values (
    p_case_id, 'SESSION', p_visit_date, 'Session ' || v_number,
    nullif(btrim(coalesce(p_observation, '')), ''),
    v_number, 'SCHEDULED', coalesce(p_doctor_id, p_actor), p_next_visit_date, p_actor
  )
  returning * into v_visit;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (p_actor, 'SESSION_CREATED', 'case_visit', v_visit.id, p_case_id,
          jsonb_build_object('session_number', v_number, 'visit_date', p_visit_date,
                             'next_visit_date', p_next_visit_date));

  return v_visit;
end;
$$;

-- Compulsory photos: a session closes only when every session view has an
-- uploaded image. NOT_AVAILABLE counts only when an administrator set it.
create or replace function public.complete_treatment_session(p_visit_id uuid, p_actor uuid)
returns public.case_visits
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_visit public.case_visits;
  v_case public.cases;
  v_missing text[];
  v_completed integer;
begin
  select * into v_visit from public.case_visits where id = p_visit_id for update;
  if not found or v_visit.visit_type <> 'SESSION' then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
  if not public.actor_can_write_case(v_visit.case_id, p_actor) then
    raise exception 'You cannot complete this session' using errcode = '42501';
  end if;
  if v_visit.session_status = 'COMPLETED' then
    return v_visit;
  end if;

  select array_agg(t.display_name order by t.sort_order) into v_missing
  from public.image_view_types t
  left join public.clinical_images i on i.visit_id = p_visit_id and i.view_type_id = t.id
  left join public.profiles np on np.id = i.not_available_by
  left join public.roles nr on nr.id = np.role_id
  where t.is_active and t.applies_to = 'SESSION'
    -- coalesce: with no slot row at all the comparison is NULL, which must
    -- count as missing rather than silently passing.
    and not coalesce(
      i.availability_status = 'UPLOADED'
      or (i.availability_status = 'NOT_AVAILABLE' and nr.code = 'ADMIN'),
      false
    );

  if v_missing is not null then
    raise exception 'Photos still missing: %. Upload them before completing this session.', array_to_string(v_missing, ', ')
      using errcode = '23514';
  end if;

  update public.case_visits
  set session_status = 'COMPLETED',
      completed_at = now(),
      completed_by = p_actor,
      images_locked_at = coalesce(images_locked_at, now()),
      details_locked_at = coalesce(details_locked_at, now())
  where id = p_visit_id
  returning * into v_visit;

  select * into v_case from public.cases where id = v_visit.case_id for update;
  select count(*) into v_completed
  from public.case_visits where case_id = v_case.id and visit_type = 'SESSION' and session_status = 'COMPLETED';

  if v_case.planned_sessions is not null and v_completed >= v_case.planned_sessions and v_case.status = 'ACTIVE' then
    update public.cases set status = 'COMPLETED' where id = v_case.id;
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (p_actor, 'SESSION_COMPLETED', 'case_visit', p_visit_id, v_visit.case_id,
          jsonb_build_object('session_number', v_visit.session_number,
                             'completed_sessions', v_completed,
                             'planned_sessions', v_case.planned_sessions));

  return v_visit;
end;
$$;

create or replace function public.link_case_to_patient(p_case_id uuid, p_patient_id uuid, p_actor uuid)
returns public.cases
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.cases;
  v_patient public.patients;
begin
  if not exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = p_actor and p.is_active and r.code = 'ADMIN'
  ) then
    raise exception 'Only an administrator can link a case to a patient' using errcode = '42501';
  end if;

  select * into v_patient from public.patients where id = p_patient_id;
  if not found then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;

  update public.cases
  set patient_id = p_patient_id, branch_id = coalesce(branch_id, v_patient.branch_id)
  where id = p_case_id and patient_id is null
  returning * into v_case;

  if not found then
    raise exception 'This case is already linked to a patient' using errcode = '22023';
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (p_actor, 'CASE_LINKED_TO_PATIENT', 'case', p_case_id, p_case_id,
          jsonb_build_object('file_id', v_patient.file_id, 'case_number', v_case.case_number));

  return v_case;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Completion knows about session-based treatments
-- ---------------------------------------------------------------------------
create or replace function public.case_completion(p_case_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with c as (
    select * from public.cases where id = p_case_id
  ),
  standard_views as (
    select count(*)::int as n from public.image_view_types where is_standard and is_active
  ),
  before_visit as (
    select id from public.case_visits where case_id = p_case_id and visit_type = 'BEFORE' limit 1
  ),
  before_slots as (
    select
      count(*) filter (where i.availability_status in ('UPLOADED', 'NOT_AVAILABLE'))::int as resolved,
      count(*) filter (where i.review_status = 'APPROVED')::int as approved
    from public.clinical_images i
    join before_visit bv on bv.id = i.visit_id
  ),
  after_visit as (
    select id from public.case_visits where case_id = p_case_id and visit_type = 'AFTER' limit 1
  ),
  after_slots as (
    select
      count(*) filter (where i.availability_status in ('UPLOADED', 'NOT_AVAILABLE'))::int as resolved,
      count(*) filter (where i.review_status = 'APPROVED')::int as approved
    from public.clinical_images i
    join after_visit av on av.id = i.visit_id
  ),
  followups as (
    select count(*)::int as n from public.case_visits
    where case_id = p_case_id and visit_type = 'FOLLOW_UP'
  ),
  sessions as (
    select
      count(*)::int as total,
      count(*) filter (where session_status = 'COMPLETED')::int as completed
    from public.case_visits
    where case_id = p_case_id and visit_type = 'SESSION'
  ),
  notes as (
    select
      coalesce(btrim(patient_concern), '') <> '' as has_concern,
      coalesce(btrim(preop_assessment), '') <> '' as has_assessment,
      coalesce(btrim(surgeon_assessment), '') <> '' as has_surgeon_assessment,
      coalesce(btrim(outcome), '') <> '' as has_outcome,
      complications_present is not null as has_complications_answer,
      revision_required is not null as has_revision_answer
    from public.case_notes where case_id = p_case_id
  ),
  changes as (
    select count(*)::int as n from public.case_changes_performed where case_id = p_case_id
  ),
  consent as (
    select image_use_consent from public.case_current_consent where case_id = p_case_id
  ),
  review as (
    select status from public.case_reviews where case_id = p_case_id
  )
  select jsonb_build_object(
    'treatment_mode', (select treatment_mode from c),
    'case_information',
      (select procedure_id is not null and case
         when treatment_mode = 'SESSIONS' then planned_sessions is not null and start_date is not null
         else surgery_date is not null and procedure_type_id is not null
       end from c),
    'before_images',
      coalesce((select resolved from before_slots), 0) >= (select n from standard_views)
      and coalesce((select approved from before_slots), 0) >= (select n from standard_views),
    'before_images_resolved', coalesce((select resolved from before_slots), 0),
    'before_images_approved', coalesce((select approved from before_slots), 0),
    'before_images_review',
      coalesce((select public.visit_image_review_status(id) from before_visit), 'NOT_SUBMITTED'),
    'after_images',
      coalesce((select resolved from after_slots), 0) >= (select n from standard_views)
      and coalesce((select approved from after_slots), 0) >= (select n from standard_views),
    'after_images_resolved', coalesce((select resolved from after_slots), 0),
    'after_images_approved', coalesce((select approved from after_slots), 0),
    'after_images_review',
      coalesce((select public.visit_image_review_status(id) from after_visit), 'NOT_SUBMITTED'),
    'standard_view_count', (select n from standard_views),
    'followups', coalesce((select n from followups), 0) > 0,
    'followup_count', coalesce((select n from followups), 0),
    'sessions_planned', (select planned_sessions from c),
    'sessions_total', coalesce((select total from sessions), 0),
    'sessions_completed', coalesce((select completed from sessions), 0),
    'sessions',
      (select planned_sessions from c) is not null
      and coalesce((select completed from sessions), 0) >= (select planned_sessions from c),
    'case_notes',
      coalesce((
        select has_concern and has_assessment and has_surgeon_assessment
               and has_outcome and has_complications_answer and has_revision_answer
        from notes
      ), false) and coalesce((select n from changes), 0) > 0,
    'consent', (select image_use_consent is not null from consent),
    'expert_review', coalesce((select status from review), 'PENDING') = 'COMPLETED'
  );
$$;

grant execute on function public.case_completion(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Read models
-- ---------------------------------------------------------------------------
drop view if exists public.case_admin_list_view;
drop view if exists public.case_list_view;

create view public.case_list_view
with (security_invoker = true)
as
select
  c.id,
  c.case_number,
  c.procedure_id,
  p.display_name as procedure_name,
  c.procedure_type_id,
  pt.display_name as procedure_type_name,
  c.surgery_date,
  c.status,
  c.followup_availability,
  c.archived_at,
  c.information_locked_at,
  c.created_at,
  c.updated_at,
  c.created_by,
  c.version,
  fu.latest_followup_date,
  fu.latest_followup_label,
  fu.followup_count,
  cc.image_use_consent,
  cc.recorded_at as consent_recorded_at,
  coalesce(r.status, 'PENDING') as review_status,
  r.reviewed_at,
  bef.uploaded_count as before_uploaded_count,
  bef.not_available_count as before_not_available_count,
  aft.uploaded_count as after_uploaded_count,
  aft.not_available_count as after_not_available_count,
  (select count(*) from public.image_view_types t where t.is_standard and t.is_active)
    as standard_view_count,
  coalesce(tg.tag_ids, '{}'::uuid[]) as tag_ids,
  -- Treatment / patient context. The patient join is subject to patients RLS,
  -- so a VIEWER sees null here: no File ID, no identity.
  c.patient_id,
  pa.file_id,
  c.branch_id,
  b.code as branch_code,
  c.treatment_mode,
  c.planned_sessions,
  c.start_date,
  coalesce(se.completed, 0) as completed_sessions,
  coalesce(se.total, 0) as session_count,
  se.next_visit_date as next_session_date,
  c.surgeon_id,
  c.surgery_marked_at
from public.cases c
join public.procedures p on p.id = c.procedure_id
left join public.procedure_types pt on pt.id = c.procedure_type_id
left join public.patients pa on pa.id = c.patient_id
left join public.branches b on b.id = c.branch_id
left join lateral (
  select
    max(v.visit_date) as latest_followup_date,
    (
      select v2.display_label
      from public.case_visits v2
      where v2.case_id = c.id and v2.visit_type = 'FOLLOW_UP'
      order by v2.visit_date desc nulls last, v2.created_at desc
      limit 1
    ) as latest_followup_label,
    count(*) as followup_count
  from public.case_visits v
  where v.case_id = c.id and v.visit_type = 'FOLLOW_UP'
) fu on true
left join lateral (
  select
    count(*)::int as total,
    count(*) filter (where v.session_status = 'COMPLETED')::int as completed,
    max(v.next_visit_date) as next_visit_date
  from public.case_visits v
  where v.case_id = c.id and v.visit_type = 'SESSION'
) se on true
left join public.case_current_consent cc on cc.case_id = c.id
left join public.case_reviews r on r.case_id = c.id
left join lateral (
  select s.uploaded_count, s.not_available_count
  from public.visit_image_summary s
  join public.case_visits bv on bv.id = s.visit_id
  where bv.case_id = c.id and bv.visit_type = 'BEFORE'
  limit 1
) bef on true
left join lateral (
  select s.uploaded_count, s.not_available_count
  from public.visit_image_summary s
  join public.case_visits av on av.id = s.visit_id
  where av.case_id = c.id and av.visit_type = 'AFTER'
  limit 1
) aft on true
left join lateral (
  select array_agg(ct.tag_id) as tag_ids
  from public.case_tags ct
  where ct.case_id = c.id
) tg on true;

grant select on public.case_list_view to authenticated, service_role;

create view public.case_admin_list_view
with (security_invoker = true)
as
select
  clv.*,
  p.display_name as creator_name
from public.case_list_view clv
left join public.profiles p on p.id = clv.created_by
where public.is_admin();

grant select on public.case_admin_list_view to authenticated, service_role;

create or replace view public.patient_list_view
with (security_invoker = true)
as
select
  p.id,
  p.file_id,
  p.branch_id,
  b.code as branch_code,
  b.name as branch_name,
  p.full_name,
  p.phone,
  p.sex,
  p.age_years,
  p.age_recorded_on,
  p.referred_by_id,
  rp.display_name as referred_by_name,
  p.referral_source,
  p.referred_for_procedure_id,
  rpr.display_name as referred_for_name,
  p.referral_note,
  p.first_visit_date,
  p.archived_at,
  p.created_at,
  p.updated_at,
  p.version,
  coalesce(tx.active_treatments, 0) as active_treatments,
  coalesce(tx.total_treatments, 0) as total_treatments,
  lv.last_visit_date,
  nv.next_visit_date
from public.patients p
join public.branches b on b.id = p.branch_id
left join public.profiles rp on rp.id = p.referred_by_id
left join public.procedures rpr on rpr.id = p.referred_for_procedure_id
left join lateral (
  select
    count(*) filter (where c.status in ('PLANNED', 'ACTIVE'))::int as active_treatments,
    count(*) filter (where c.status <> 'ARCHIVED')::int as total_treatments
  from public.cases c
  where c.patient_id = p.id
) tx on true
left join lateral (
  select max(d) as last_visit_date
  from (
    select pc.visit_date as d from public.patient_consultations pc where pc.patient_id = p.id
    union all
    select v.visit_date from public.case_visits v join public.cases c on c.id = v.case_id
    where c.patient_id = p.id and v.visit_date is not null and v.visit_date <= current_date
  ) x
) lv on true
left join lateral (
  select min(d) as next_visit_date
  from (
    select pc.next_visit_date as d from public.patient_consultations pc
    where pc.patient_id = p.id and pc.next_visit_date >= current_date
    union all
    select n.next_visit_date from public.patient_notes n
    where n.patient_id = p.id and n.next_visit_date >= current_date
    union all
    select v.next_visit_date from public.case_visits v join public.cases c on c.id = v.case_id
    where c.patient_id = p.id and v.next_visit_date >= current_date
    union all
    select c.surgery_date from public.cases c
    where c.patient_id = p.id and c.surgery_date >= current_date and c.status in ('PLANNED', 'ACTIVE')
  ) y
) nv on true;

grant select on public.patient_list_view to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Realtime and grants
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['patients', 'patient_consultations', 'patient_notes', 'patient_documents']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
    end if;
  end loop;
end;
$$;

do $$
declare
  sig text;
begin
  foreach sig in array array[
    'public.next_case_number_for(text)',
    'public.actor_can_write_case(uuid, uuid)',
    'public.create_treatment(uuid, uuid, uuid, uuid, text, integer, date, date, uuid, text, uuid[], uuid)',
    'public.add_treatment_session(uuid, date, uuid, text, date, uuid)',
    'public.complete_treatment_session(uuid, uuid)',
    'public.link_case_to_patient(uuid, uuid, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated;', sig);
    execute format('grant execute on function %s to service_role;', sig);
  end loop;
end;
$$;

commit;
