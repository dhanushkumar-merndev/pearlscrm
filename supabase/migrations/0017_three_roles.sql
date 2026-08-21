-- Keep only the roles used by the clinic: Administrator, Doctor, and Viewer.
-- Existing Surgeon and Clinical Staff accounts are migrated to Doctor so no
-- active account loses clinical access during this change.

begin;

insert into public.roles (code, name)
values ('DOCTOR', 'Doctor')
on conflict (code) do update set name = excluded.name;

update public.profiles as profile
set role_id = doctor.id
from public.roles as legacy
cross join public.roles as doctor
where profile.role_id = legacy.id
  and legacy.code in ('SURGEON', 'STAFF')
  and doctor.code = 'DOCTOR';

delete from public.roles
where code in ('SURGEON', 'STAFF');

alter table public.roles drop constraint if exists roles_code_allowed;
alter table public.roles
  add constraint roles_code_allowed check (code in ('ADMIN', 'DOCTOR', 'VIEWER'));

create or replace function public.can_write_clinical()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_code() in ('ADMIN', 'DOCTOR');
$$;

create or replace function public.can_manage_cases()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_code() in ('ADMIN', 'DOCTOR');
$$;

commit;
