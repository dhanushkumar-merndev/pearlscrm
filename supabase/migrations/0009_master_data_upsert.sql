-- AURA Clinical Data Library
-- 0009: concurrency-safe "create or return existing" for self-learning dropdowns.
--
-- Correctness under concurrent requests comes from the unique index on
-- normalized_key, not from a read-then-write check in application code.

create or replace function public.upsert_master_value(
  p_table text,
  p_display_name text,
  p_actor uuid default auth.uid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_display text;
  v_row jsonb;
  v_created boolean := false;
begin
  if p_table not in (
    'procedures', 'procedure_types', 'complication_types',
    'clinical_tags', 'followup_label_presets'
  ) then
    raise exception 'unknown master table: %', p_table using errcode = '22023';
  end if;

  v_display := public.normalize_master_display(p_display_name);
  v_key := public.normalize_master_key(p_display_name);

  if v_key = '' then
    raise exception 'value cannot be empty' using errcode = '22023';
  end if;

  if length(v_display) > 200 then
    raise exception 'value is too long' using errcode = '22001';
  end if;

  -- Insert-first; the unique index resolves races. A conflicting insert falls
  -- through to the select below and returns the winning row.
  execute format(
    'insert into public.%I (normalized_key, display_name, created_by)
     values ($1, $2, $3)
     on conflict (normalized_key) do nothing
     returning to_jsonb(%I.*)',
    p_table, p_table
  )
  into v_row
  using v_key, v_display, p_actor;

  if v_row is not null then
    v_created := true;
  else
    execute format(
      'select to_jsonb(t.*) from public.%I t where t.normalized_key = $1',
      p_table
    )
    into v_row
    using v_key;
  end if;

  if v_created then
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
    values (
      p_actor, 'MASTER_VALUE_CREATED', p_table, (v_row ->> 'id')::uuid,
      jsonb_build_object('display_name', v_display, 'normalized_key', v_key)
    );
  end if;

  return jsonb_build_object('created', v_created, 'value', v_row);
end;
$$;

revoke all on function public.upsert_master_value(text, text, uuid) from public;
grant execute on function public.upsert_master_value(text, text, uuid) to service_role;

create or replace function public.set_master_value_active(
  p_table text,
  p_id uuid,
  p_is_active boolean,
  p_actor uuid default auth.uid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
begin
  if p_table not in (
    'procedures', 'procedure_types', 'complication_types',
    'clinical_tags', 'followup_label_presets'
  ) then
    raise exception 'unknown master table: %', p_table using errcode = '22023';
  end if;

  execute format(
    'update public.%I set is_active = $1 where id = $2 returning to_jsonb(%I.*)',
    p_table, p_table
  )
  into v_row
  using p_is_active, p_id;

  if v_row is null then
    raise exception 'master value not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor,
    case when p_is_active then 'MASTER_VALUE_ENABLED' else 'MASTER_VALUE_DISABLED' end,
    p_table, p_id,
    jsonb_build_object('display_name', v_row ->> 'display_name', 'is_active', p_is_active)
  );

  return v_row;
end;
$$;

revoke all on function public.set_master_value_active(text, uuid, boolean, uuid) from public;
grant execute on function public.set_master_value_active(text, uuid, boolean, uuid) to service_role;
