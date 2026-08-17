-- AURA Clinical Data Library
-- 0002: self-learning master-data tables.
--
-- Every master table shares the same shape so a single generic server service
-- can search/create values for any of them.

-- Shared normalization used by both the DB and the application layer.
-- Trim, collapse internal whitespace, lowercase.
create or replace function public.normalize_master_key(input text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(btrim(coalesce(input, '')), '\s+', ' ', 'g'));
$$;

-- Shared display normalization: trim + collapse whitespace, preserve case.
create or replace function public.normalize_master_display(input text)
returns text
language sql
immutable
as $$
  select regexp_replace(btrim(coalesce(input, '')), '\s+', ' ', 'g');
$$;

create table if not exists public.procedures (
  id uuid primary key default gen_random_uuid(),
  normalized_key text not null unique,
  display_name text not null,
  is_active boolean not null default true,
  usage_count integer not null default 0,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procedures_display_name_not_blank check (btrim(display_name) <> '')
);

create table if not exists public.procedure_types (
  id uuid primary key default gen_random_uuid(),
  normalized_key text not null unique,
  display_name text not null,
  is_active boolean not null default true,
  usage_count integer not null default 0,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procedure_types_display_name_not_blank check (btrim(display_name) <> '')
);

create table if not exists public.complication_types (
  id uuid primary key default gen_random_uuid(),
  normalized_key text not null unique,
  display_name text not null,
  is_active boolean not null default true,
  usage_count integer not null default 0,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint complication_types_display_name_not_blank check (btrim(display_name) <> '')
);

create table if not exists public.clinical_tags (
  id uuid primary key default gen_random_uuid(),
  normalized_key text not null unique,
  display_name text not null,
  is_active boolean not null default true,
  usage_count integer not null default 0,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_tags_display_name_not_blank check (btrim(display_name) <> '')
);

create table if not exists public.followup_label_presets (
  id uuid primary key default gen_random_uuid(),
  normalized_key text not null unique,
  display_name text not null,
  is_active boolean not null default true,
  usage_count integer not null default 0,
  sort_order integer not null default 0,
  months_after_surgery numeric(6, 2),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint followup_label_presets_display_name_not_blank check (btrim(display_name) <> '')
);

-- Standard clinical image views.
create table if not exists public.image_view_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  sort_order integer not null default 0,
  is_standard boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Search indexes on normalized keys + trigram for "type to search".
create index if not exists procedures_normalized_key_trgm
  on public.procedures using gin (normalized_key gin_trgm_ops);
create index if not exists procedure_types_normalized_key_trgm
  on public.procedure_types using gin (normalized_key gin_trgm_ops);
create index if not exists complication_types_normalized_key_trgm
  on public.complication_types using gin (normalized_key gin_trgm_ops);
create index if not exists clinical_tags_normalized_key_trgm
  on public.clinical_tags using gin (normalized_key gin_trgm_ops);
create index if not exists followup_label_presets_normalized_key_trgm
  on public.followup_label_presets using gin (normalized_key gin_trgm_ops);

create index if not exists procedures_is_active_idx on public.procedures (is_active);
create index if not exists procedure_types_is_active_idx on public.procedure_types (is_active);
create index if not exists complication_types_is_active_idx on public.complication_types (is_active);
create index if not exists clinical_tags_is_active_idx on public.clinical_tags (is_active);
create index if not exists followup_label_presets_is_active_idx on public.followup_label_presets (is_active);

do $$
declare
  t text;
begin
  foreach t in array array[
    'procedures',
    'procedure_types',
    'complication_types',
    'clinical_tags',
    'followup_label_presets'
  ]
  loop
    execute format(
      'drop trigger if exists %1$s_set_updated_at on public.%1$s;
       create trigger %1$s_set_updated_at before update on public.%1$s
       for each row execute function public.set_updated_at();',
      t
    );
  end loop;
end;
$$;
