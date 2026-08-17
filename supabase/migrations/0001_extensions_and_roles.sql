-- AURA Clinical Data Library
-- 0001: extensions, roles, profiles, and role-check helper functions.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- roles
-- ---------------------------------------------------------------------------
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  constraint roles_code_allowed check (code in ('ADMIN', 'SURGEON', 'STAFF', 'VIEWER'))
);

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role_id uuid not null references public.roles (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_id_idx on public.profiles (role_id);
create index if not exists profiles_is_active_idx on public.profiles (is_active);

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Authorization helper functions.
--
-- These are SECURITY DEFINER and read profiles/roles directly so that RLS
-- policies on clinical tables never recurse back through a policy-protected
-- read of `profiles`.
-- ---------------------------------------------------------------------------
create or replace function public.current_role_code()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.code
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid()
    and p.is_active = true;
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active = true
  );
$$;

create or replace function public.has_role(codes text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_code() = any (codes);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_code() = 'ADMIN';
$$;

-- Roles allowed to write clinical data.
create or replace function public.can_write_clinical()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_code() in ('ADMIN', 'STAFF', 'SURGEON');
$$;

-- Roles allowed to create/modify structural case records (cases, visits, images).
create or replace function public.can_manage_cases()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_code() in ('ADMIN', 'STAFF');
$$;

revoke all on function public.current_role_code() from public;
revoke all on function public.is_active_user() from public;
revoke all on function public.has_role(text[]) from public;
revoke all on function public.is_admin() from public;
revoke all on function public.can_write_clinical() from public;
revoke all on function public.can_manage_cases() from public;

grant execute on function public.current_role_code() to authenticated, service_role;
grant execute on function public.is_active_user() to authenticated, service_role;
grant execute on function public.has_role(text[]) to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.can_write_clinical() to authenticated, service_role;
grant execute on function public.can_manage_cases() to authenticated, service_role;
