-- Pearl Aesthetic Clinic Library
-- 0033: "Mark for Surgery" and automatic surgery reminders.
--
-- Marking a surgical treatment sets its date and surgeon and schedules two
-- reminders in the clinic's timezone (Asia/Kolkata unless app_settings says
-- otherwise):
--
--   DAY_BEFORE   18:00 the evening before
--   MORNING_OF   08:00 on the day
--
-- A pg_cron job runs every five minutes and turns each due reminder into an
-- in-app notification for the surgeon and every active ADMIN/DOCTOR whose home
-- branch is the treatment's branch. 0034 then delivers notifications as web
-- push. Reminder text carries File ID, procedure, case number, branch and date
-- — never the patient's name or phone, because push text passes through
-- Google's and the browser vendor's push services.

begin;

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- 1. Clinic timezone
-- ---------------------------------------------------------------------------
create or replace function public.clinic_timezone()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select value #>> '{}' from public.app_settings where key = 'clinic.timezone'
       and (value #>> '{}') in (select name from pg_timezone_names)),
    'Asia/Kolkata'
  );
$$;

revoke all on function public.clinic_timezone() from public, anon;
grant execute on function public.clinic_timezone() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Reminders
-- ---------------------------------------------------------------------------
create table if not exists public.surgery_reminders (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  kind text not null,
  surgery_date date not null,
  remind_at timestamptz not null,
  status text not null default 'PENDING',
  sent_at timestamptz,
  recipient_count integer,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint surgery_reminders_kind_allowed check (kind in ('DAY_BEFORE', 'MORNING_OF')),
  constraint surgery_reminders_status_allowed check (status in ('PENDING', 'SENT', 'CANCELLED', 'EXPIRED'))
);

create unique index if not exists surgery_reminders_one_pending
  on public.surgery_reminders (case_id, kind) where status = 'PENDING';
create index if not exists surgery_reminders_due_idx
  on public.surgery_reminders (remind_at) where status = 'PENDING';
create index if not exists surgery_reminders_case_idx on public.surgery_reminders (case_id);

alter table public.surgery_reminders enable row level security;
alter table public.surgery_reminders force row level security;

drop policy if exists surgery_reminders_select on public.surgery_reminders;
create policy surgery_reminders_select on public.surgery_reminders
  for select to authenticated using (public.case_is_visible(case_id));

-- ---------------------------------------------------------------------------
-- 3. Mark / reschedule / cancel
-- ---------------------------------------------------------------------------
create or replace function public.schedule_surgery_reminders(
  p_case_id uuid,
  p_surgery_date date,
  p_actor uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text := public.clinic_timezone();
  v_day_before timestamptz := ((p_surgery_date - 1) + time '18:00') at time zone v_tz;
  v_morning timestamptz := (p_surgery_date + time '08:00') at time zone v_tz;
  v_n integer := 0;
begin
  update public.surgery_reminders set status = 'CANCELLED'
  where case_id = p_case_id and status = 'PENDING';

  -- A time already past (surgery marked for today or tomorrow evening) is
  -- skipped rather than sent late.
  if v_day_before > now() then
    insert into public.surgery_reminders (case_id, kind, surgery_date, remind_at, created_by)
    values (p_case_id, 'DAY_BEFORE', p_surgery_date, v_day_before, p_actor);
    v_n := v_n + 1;
  end if;
  if v_morning > now() then
    insert into public.surgery_reminders (case_id, kind, surgery_date, remind_at, created_by)
    values (p_case_id, 'MORNING_OF', p_surgery_date, v_morning, p_actor);
    v_n := v_n + 1;
  end if;
  return v_n;
end;
$$;

create or replace function public.mark_case_for_surgery(
  p_case_id uuid,
  p_surgery_date date,
  p_surgeon_id uuid,
  p_actor uuid
)
returns public.cases
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.cases;
  v_old_date date;
  v_today date := (now() at time zone public.clinic_timezone())::date;
  v_reminders integer;
begin
  if not public.actor_can_write_case(p_case_id, p_actor) then
    raise exception 'You cannot schedule surgery for this treatment' using errcode = '42501';
  end if;

  select * into v_case from public.cases where id = p_case_id for update;
  if v_case.treatment_mode <> 'SURGICAL' then
    raise exception 'Only surgical treatments can be marked for surgery' using errcode = '22023';
  end if;
  if v_case.status in ('ARCHIVED', 'COMPLETED') then
    raise exception 'This treatment is closed' using errcode = '22023';
  end if;
  if p_surgery_date is null or p_surgery_date < v_today then
    raise exception 'Choose today or a future date for surgery' using errcode = '22023';
  end if;
  -- Once surgery has happened its date anchors every follow-up interval.
  if v_case.surgery_date is not null and v_case.surgery_date < v_today then
    raise exception 'This surgery date has already passed and cannot be rescheduled' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = p_surgeon_id and p.is_active and r.code in ('ADMIN', 'DOCTOR')
  ) then
    raise exception 'Choose an active doctor as the surgeon' using errcode = '22023';
  end if;

  v_old_date := v_case.surgery_date;

  update public.cases
  set surgery_date = p_surgery_date,
      surgeon_id = p_surgeon_id,
      surgery_marked_at = now(),
      surgery_marked_by = p_actor,
      status = case when status = 'PLANNED' then 'ACTIVE' else status end,
      version = version + 1
  where id = p_case_id
  returning * into v_case;

  -- The Before phase is dated to the surgery by convention.
  update public.case_visits
  set visit_date = p_surgery_date
  where case_id = p_case_id and visit_type = 'BEFORE'
    and (visit_date is null or visit_date is not distinct from v_old_date);

  -- The surgeon needs write access to the treatment they will operate on.
  insert into public.case_viewer_access (case_id, user_id, granted_by)
  select p_case_id, p_surgeon_id, p_actor
  where exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = p_surgeon_id and r.code = 'DOCTOR'
  )
  on conflict do nothing;

  v_reminders := public.schedule_surgery_reminders(p_case_id, p_surgery_date, p_actor);

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor,
    case when v_old_date is null then 'SURGERY_SCHEDULED' else 'SURGERY_RESCHEDULED' end,
    'case', p_case_id, p_case_id,
    jsonb_build_object('case_number', v_case.case_number, 'surgery_date', p_surgery_date,
                       'previous_surgery_date', v_old_date, 'surgeon_id', p_surgeon_id,
                       'reminders_scheduled', v_reminders)
  );

  return v_case;
end;
$$;

create or replace function public.cancel_surgery_schedule(p_case_id uuid, p_actor uuid)
returns public.cases
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.cases;
  v_old_date date;
  v_today date := (now() at time zone public.clinic_timezone())::date;
begin
  if not public.actor_can_write_case(p_case_id, p_actor) then
    raise exception 'You cannot change this surgery' using errcode = '42501';
  end if;

  select * into v_case from public.cases where id = p_case_id for update;
  if v_case.treatment_mode <> 'SURGICAL' or v_case.surgery_date is null then
    raise exception 'No surgery is scheduled' using errcode = '22023';
  end if;
  if v_case.surgery_date < v_today then
    raise exception 'This surgery date has already passed' using errcode = '22023';
  end if;

  v_old_date := v_case.surgery_date;

  update public.cases
  set surgery_date = null, status = 'PLANNED', surgery_marked_at = null, surgery_marked_by = null,
      version = version + 1
  where id = p_case_id
  returning * into v_case;

  update public.case_visits set visit_date = null
  where case_id = p_case_id and visit_type = 'BEFORE' and visit_date = v_old_date;

  update public.surgery_reminders set status = 'CANCELLED'
  where case_id = p_case_id and status = 'PENDING';

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (p_actor, 'SURGERY_CANCELLED', 'case', p_case_id, p_case_id,
          jsonb_build_object('case_number', v_case.case_number, 'previous_surgery_date', v_old_date));

  return v_case;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Dispatch (pg_cron, every five minutes)
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_due_reminders(p_now timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_sent integer := 0;
  v_recipients integer;
  v_title text;
  v_body text;
begin
  for r in
    select sr.id, sr.kind, sr.remind_at, sr.surgery_date,
           c.id as case_id, c.case_number, c.branch_id, c.surgeon_id, c.status, c.surgery_date as case_date,
           pa.file_id, pr.display_name as procedure_name, b.name as branch_name
    from public.surgery_reminders sr
    join public.cases c on c.id = sr.case_id
    join public.procedures pr on pr.id = c.procedure_id
    left join public.patients pa on pa.id = c.patient_id
    left join public.branches b on b.id = c.branch_id
    where sr.status = 'PENDING' and sr.remind_at <= p_now
    order by sr.remind_at
    for update of sr skip locked
  loop
    -- Stale (the job was down for hours) or no longer true: do not ring.
    if r.remind_at < p_now - interval '6 hours'
       or r.status not in ('ACTIVE') or r.case_date is distinct from r.surgery_date then
      update public.surgery_reminders set status = 'EXPIRED' where id = r.id;
      continue;
    end if;

    v_title := case when r.kind = 'DAY_BEFORE' then 'Surgery tomorrow' else 'Surgery today' end;
    v_body := concat_ws(' · ',
      r.file_id, r.procedure_name, r.case_number, r.branch_name,
      to_char(r.surgery_date, 'DD/MM/YYYY'));

    insert into public.notifications (recipient_id, type, title, body, case_id)
    select distinct p.id, 'SURGERY_REMINDER', v_title, left(v_body, 1000), r.case_id
    from public.profiles p
    join public.roles ro on ro.id = p.role_id
    where p.is_active
      and ro.code in ('ADMIN', 'DOCTOR')
      and (p.id = r.surgeon_id or (r.branch_id is not null and p.branch_id = r.branch_id));
    get diagnostics v_recipients = row_count;

    update public.surgery_reminders
    set status = 'SENT', sent_at = now(), recipient_count = v_recipients
    where id = r.id;

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants and schedule
-- ---------------------------------------------------------------------------
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'public.schedule_surgery_reminders(uuid, date, uuid)',
    'public.mark_case_for_surgery(uuid, date, uuid, uuid)',
    'public.cancel_surgery_schedule(uuid, uuid)',
    'public.dispatch_due_reminders(timestamptz)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated;', sig);
    execute format('grant execute on function %s to service_role;', sig);
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'surgery_reminders'
  ) then
    alter publication supabase_realtime add table public.surgery_reminders;
  end if;
end;
$$;

-- Named schedule: re-running the migration updates rather than duplicates it.
select cron.schedule('surgery-reminders', '*/5 * * * *', $$select public.dispatch_due_reminders()$$);

commit;
