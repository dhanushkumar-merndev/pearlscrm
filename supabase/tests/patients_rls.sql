-- Role-based RLS tests for patients, treatments, reminders and push (0031–0034).
--
-- Self-contained: creates its own accounts and records inside one transaction,
-- asserts as each role, and ROLLS BACK — nothing persists. Still, run it only
-- against a local or disposable database, never production:
--
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/patients_rls.sql
--
-- Any failed expectation raises an exception whose message starts with FAIL.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures (as the table owner)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('eeeeeeee-0000-4000-8000-0000000000a1', 'rls-admin@test.invalid'),
  ('eeeeeeee-0000-4000-8000-0000000000d1', 'rls-doctor-kl@test.invalid'),
  ('eeeeeeee-0000-4000-8000-0000000000d2', 'rls-doctor-bg@test.invalid'),
  ('eeeeeeee-0000-4000-8000-0000000000f1', 'rls-viewer@test.invalid'),
  ('eeeeeeee-0000-4000-8000-0000000000f2', 'rls-viewer-all@test.invalid')
on conflict (id) do nothing;

insert into public.profiles (id, display_name, role_id, is_active, branch_id, case_visibility_scope)
select u.id, u.name, r.id, true, b.id, u.scope
from (values
  ('eeeeeeee-0000-4000-8000-0000000000a1'::uuid, 'RLS Admin', 'ADMIN', 'KL', 'ALL'),
  ('eeeeeeee-0000-4000-8000-0000000000d1'::uuid, 'RLS Doctor KL', 'DOCTOR', 'KL', 'SELECTED'),
  ('eeeeeeee-0000-4000-8000-0000000000d2'::uuid, 'RLS Doctor BG', 'DOCTOR', 'BG', 'SELECTED'),
  ('eeeeeeee-0000-4000-8000-0000000000f1'::uuid, 'RLS Viewer', 'VIEWER', 'KL', 'SELECTED'),
  ('eeeeeeee-0000-4000-8000-0000000000f2'::uuid, 'RLS Viewer All', 'VIEWER', 'KL', 'ALL')
) as u(id, name, code, branch, scope)
join public.roles r on r.code = u.code
join public.branches b on b.code = u.branch
on conflict (id) do update set role_id = excluded.role_id, branch_id = excluded.branch_id,
  is_active = true, case_visibility_scope = excluded.case_visibility_scope;

create temp table rls_fixture (k text primary key, v uuid) on commit drop;
grant select on rls_fixture to authenticated, anon;

do $$
declare
  v_patient public.patients;
  v_case public.cases;
  v_proc uuid;
begin
  select * into v_patient from public.create_patient(
    (select id from public.branches where code = 'KL'),
    'RLS Test Patient', '+91 90000 00000', 'FEMALE', 30::smallint,
    'eeeeeeee-0000-4000-8000-0000000000d1', null, null, null,
    current_date, 'rls test consultation', null,
    'eeeeeeee-0000-4000-8000-0000000000d1');

  select id into v_proc from public.procedures where default_mode = 'SESSIONS' and is_active limit 1;

  select * into v_case from public.create_treatment(
    v_patient.id, null, v_proc, null, 'SESSIONS', 3::smallint, current_date, null, null, null,
    array[]::uuid[], 'eeeeeeee-0000-4000-8000-0000000000d1');

  insert into rls_fixture values ('patient', v_patient.id), ('case', v_case.id);

  insert into public.push_tokens (user_id, token, user_agent)
  values ('eeeeeeee-0000-4000-8000-0000000000d1', 'rls-test-token-d1-' || repeat('x', 120), 'rls test');
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.expect(p_ok boolean, p_what text) returns void
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'FAIL: %', p_what;
  end if;
  raise notice 'ok   %', p_what;
end;
$$;

-- ---------------------------------------------------------------------------
-- Doctor at another branch (BG): reads the KL patient's whole history, writes nothing
-- ---------------------------------------------------------------------------
select pg_temp.act_as('eeeeeeee-0000-4000-8000-0000000000d2');

select pg_temp.expect(
  (select count(*) from public.patients where id = (select v from rls_fixture where k = 'patient')) = 1,
  'BG doctor can read a KL patient');
select pg_temp.expect(
  (select count(*) from public.patient_list_view where id = (select v from rls_fixture where k = 'patient')) = 1,
  'BG doctor sees the KL patient in patient_list_view');
select pg_temp.expect(
  (select count(*) from public.patient_consultations where patient_id = (select v from rls_fixture where k = 'patient')) = 1,
  'BG doctor can read the first consultation');
select pg_temp.expect(
  (select count(*) from public.cases where id = (select v from rls_fixture where k = 'case')) = 1,
  'BG doctor can read the KL treatment');
select pg_temp.expect(
  public.case_is_writable((select v from rls_fixture where k = 'case')) = false,
  'BG doctor cannot write the KL treatment (case_is_writable)');

do $$
declare n int;
begin
  update public.cases set followup_availability = 'tampered'
  where id = (select v from rls_fixture where k = 'case');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'BG doctor UPDATE on the KL treatment affects 0 rows');

  update public.patients set full_name = 'tampered'
  where id = (select v from rls_fixture where k = 'patient');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'BG doctor direct UPDATE on patients affects 0 rows');
exception when insufficient_privilege then
  perform pg_temp.expect(true, 'BG doctor direct UPDATE refused by privilege');
end;
$$;

do $$
begin
  insert into public.patients (file_id, branch_id, full_name)
  values ('BG9999', (select id from public.branches where code = 'BG'), 'forged');
  raise exception 'FAIL: direct INSERT into patients was allowed';
exception
  when insufficient_privilege then perform pg_temp.expect(true, 'direct INSERT into patients refused');
end;
$$;

do $$
begin
  insert into public.patient_notes (patient_id, author_id, body)
  values ((select v from rls_fixture where k = 'patient'), 'eeeeeeee-0000-4000-8000-0000000000d2', 'forged');
  raise exception 'FAIL: direct INSERT into patient_notes was allowed';
exception
  when insufficient_privilege then perform pg_temp.expect(true, 'direct INSERT into patient_notes refused');
end;
$$;

select pg_temp.expect(
  (select count(*) from public.push_tokens) = 0,
  'BG doctor cannot see another user''s push tokens');

reset role;

-- ---------------------------------------------------------------------------
-- The assigned KL doctor can write; sees only their own push token
-- ---------------------------------------------------------------------------
select pg_temp.act_as('eeeeeeee-0000-4000-8000-0000000000d1');

select pg_temp.expect(
  public.case_is_writable((select v from rls_fixture where k = 'case')) = true,
  'creating KL doctor can write their treatment');
select pg_temp.expect(
  (select count(*) from public.push_tokens where token = 'rls-test-token-d1-' || repeat('x', 120)) = 1,
  'KL doctor sees their own push token');

reset role;

-- ---------------------------------------------------------------------------
-- VIEWER: no patient data at all
-- ---------------------------------------------------------------------------
select pg_temp.act_as('eeeeeeee-0000-4000-8000-0000000000f1');

select pg_temp.expect((select count(*) from public.patients) = 0, 'VIEWER reads no patients');
select pg_temp.expect((select count(*) from public.patient_list_view) = 0, 'VIEWER reads no patient_list_view rows');
select pg_temp.expect((select count(*) from public.patient_consultations) = 0, 'VIEWER reads no consultations');
select pg_temp.expect((select count(*) from public.patient_notes) = 0, 'VIEWER reads no patient notes');
select pg_temp.expect((select count(*) from public.patient_documents) = 0, 'VIEWER reads no prescriptions');
select pg_temp.expect(
  (select count(*) from public.case_list_view where id = (select v from rls_fixture where k = 'case')) = 0,
  'VIEWER (selected cases, no grant) cannot see the treatment');

reset role;

-- A VIEWER with "All cases" reads the case library — File ID only, never the patient.
select pg_temp.act_as('eeeeeeee-0000-4000-8000-0000000000f2');
select pg_temp.expect(
  (select count(*) from public.case_list_view where id = (select v from rls_fixture where k = 'case')) = 1,
  'VIEWER (all cases) sees the treatment in the library');
select pg_temp.expect((select count(*) from public.patients) = 0, 'VIEWER (all cases) still reads no patients');
select pg_temp.expect((select count(*) from public.patient_list_view) = 0, 'VIEWER (all cases) still reads no patient_list_view');
reset role;

-- ---------------------------------------------------------------------------
-- anon: nothing
-- ---------------------------------------------------------------------------
set local role anon;
do $$
declare n int;
begin
  select count(*) into n from public.patients;
  perform pg_temp.expect(n = 0, 'anon reads no patients');
exception when insufficient_privilege then
  perform pg_temp.expect(true, 'anon refused on patients');
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Privileged functions are not callable by signed-in clients
-- ---------------------------------------------------------------------------
select pg_temp.expect(not has_function_privilege('authenticated', 'public.next_file_id(uuid)', 'execute'), 'authenticated cannot execute next_file_id');
select pg_temp.expect(not has_function_privilege('authenticated', 'public.create_patient(uuid, text, text, text, smallint, uuid, text, uuid, text, date, text, date, uuid)', 'execute'), 'authenticated cannot execute create_patient');
select pg_temp.expect(not has_function_privilege('authenticated', 'public.dispatch_due_reminders(timestamptz)', 'execute'), 'authenticated cannot execute dispatch_due_reminders');
select pg_temp.expect(not has_function_privilege('authenticated', 'public.mark_case_for_surgery(uuid, date, uuid, uuid)', 'execute'), 'authenticated cannot execute mark_case_for_surgery');
select pg_temp.expect(not has_function_privilege('authenticated', 'public.push_payload(uuid)', 'execute'), 'authenticated cannot execute push_payload');
select pg_temp.expect(not has_function_privilege('anon', 'public.case_is_visible(uuid)', 'execute'), 'anon cannot execute case_is_visible');

-- ---------------------------------------------------------------------------
-- Concurrency-safe numbering: consecutive File IDs, no gaps
-- ---------------------------------------------------------------------------
do $$
declare
  v_first text;
  v_last text;
  i int;
  p public.patients;
begin
  for i in 1..5 loop
    select * into p from public.create_patient(
      (select id from public.branches where code = 'SH'), 'RLS Seq ' || i, null, null, null,
      null, null, null, null, null, null, null, 'eeeeeeee-0000-4000-8000-0000000000a1');
    if i = 1 then v_first := p.file_id; end if;
    v_last := p.file_id;
  end loop;
  perform pg_temp.expect(
    substring(v_last from 3)::int - substring(v_first from 3)::int = 4 and v_first like 'SH%',
    format('SH File IDs are consecutive (%s … %s)', v_first, v_last));
end;
$$;

rollback;
