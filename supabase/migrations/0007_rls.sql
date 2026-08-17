-- AURA Clinical Data Library
-- 0007: Row Level Security.
--
-- Model: every authenticated, ACTIVE user may READ clinical data. Write access
-- is role-gated. Archived cases are readable but only ADMIN may write to them.
-- The service role bypasses RLS and is only ever used from server-only code.

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. No table is left open.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'roles', 'profiles',
    'procedures', 'procedure_types', 'complication_types', 'clinical_tags',
    'followup_label_presets', 'image_view_types',
    'cases', 'case_tags', 'case_visits', 'case_number_config',
    'clinical_images', 'clinical_image_versions', 'image_upload_sessions',
    'case_notes', 'case_changes_performed', 'case_consents',
    'case_reviews', 'case_review_revisions', 'audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
  end loop;
end;
$$;

-- Helper: is this case writable by the current user right now?
create or replace function public.case_is_writable(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.cases c
    where c.id = p_case_id
      and (c.archived_at is null or public.is_admin())
  );
$$;

grant execute on function public.case_is_writable(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- roles / profiles
-- ---------------------------------------------------------------------------
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated
  using (public.is_active_user());

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.is_active_user() or id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() and public.is_active_user())
  with check (id = auth.uid());

-- User administration (role assignment, disabling) is service-role only; there
-- is deliberately no INSERT/DELETE policy for `authenticated` on profiles.

-- ---------------------------------------------------------------------------
-- Master data — readable by any active user, writable by clinical writers.
-- Deactivating a value is admin-only; deletion is never permitted.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'procedures', 'procedure_types', 'complication_types',
    'clinical_tags', 'followup_label_presets'
  ]
  loop
    execute format('drop policy if exists %1$s_select on public.%1$s;', t);
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated
       using (public.is_active_user());', t);

    execute format('drop policy if exists %1$s_insert on public.%1$s;', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert to authenticated
       with check (public.can_write_clinical());', t);

    execute format('drop policy if exists %1$s_update on public.%1$s;', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update to authenticated
       using (public.is_admin()) with check (public.is_admin());', t);
  end loop;
end;
$$;

drop policy if exists image_view_types_select on public.image_view_types;
create policy image_view_types_select on public.image_view_types
  for select to authenticated
  using (public.is_active_user());

drop policy if exists image_view_types_write on public.image_view_types;
create policy image_view_types_write on public.image_view_types
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists case_number_config_select on public.case_number_config;
create policy case_number_config_select on public.case_number_config
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- cases
-- ---------------------------------------------------------------------------
drop policy if exists cases_select on public.cases;
create policy cases_select on public.cases
  for select to authenticated
  using (public.is_active_user());

drop policy if exists cases_insert on public.cases;
create policy cases_insert on public.cases
  for insert to authenticated
  with check (public.can_manage_cases());

drop policy if exists cases_update on public.cases;
create policy cases_update on public.cases
  for update to authenticated
  using (public.can_manage_cases() and (archived_at is null or public.is_admin()))
  with check (public.can_manage_cases());

-- No delete policy: clinical cases are archived, never hard-deleted from the UI.

drop policy if exists case_tags_select on public.case_tags;
create policy case_tags_select on public.case_tags
  for select to authenticated
  using (public.is_active_user());

drop policy if exists case_tags_insert on public.case_tags;
create policy case_tags_insert on public.case_tags
  for insert to authenticated
  with check (public.can_manage_cases() and public.case_is_writable(case_id));

drop policy if exists case_tags_delete on public.case_tags;
create policy case_tags_delete on public.case_tags
  for delete to authenticated
  using (public.can_manage_cases() and public.case_is_writable(case_id));

-- ---------------------------------------------------------------------------
-- case_visits
-- ---------------------------------------------------------------------------
drop policy if exists case_visits_select on public.case_visits;
create policy case_visits_select on public.case_visits
  for select to authenticated
  using (public.is_active_user());

drop policy if exists case_visits_insert on public.case_visits;
create policy case_visits_insert on public.case_visits
  for insert to authenticated
  with check (public.can_manage_cases() and public.case_is_writable(case_id));

drop policy if exists case_visits_update on public.case_visits;
create policy case_visits_update on public.case_visits
  for update to authenticated
  using (public.can_write_clinical() and public.case_is_writable(case_id))
  with check (public.can_write_clinical() and public.case_is_writable(case_id));

drop policy if exists case_visits_delete on public.case_visits;
create policy case_visits_delete on public.case_visits
  for delete to authenticated
  using (public.is_admin() and visit_type = 'FOLLOW_UP');

-- ---------------------------------------------------------------------------
-- clinical images
-- ---------------------------------------------------------------------------
drop policy if exists clinical_images_select on public.clinical_images;
create policy clinical_images_select on public.clinical_images
  for select to authenticated
  using (public.is_active_user());

drop policy if exists clinical_images_insert on public.clinical_images;
create policy clinical_images_insert on public.clinical_images
  for insert to authenticated
  with check (public.can_manage_cases() and public.case_is_writable(case_id));

drop policy if exists clinical_images_update on public.clinical_images;
create policy clinical_images_update on public.clinical_images
  for update to authenticated
  using (public.can_manage_cases() and public.case_is_writable(case_id))
  with check (public.can_manage_cases() and public.case_is_writable(case_id));

drop policy if exists clinical_image_versions_select on public.clinical_image_versions;
create policy clinical_image_versions_select on public.clinical_image_versions
  for select to authenticated
  using (public.is_active_user());

-- Version rows are only ever written by server-side privileged code
-- (finalize_image_upload). No insert/update policy for `authenticated`.

-- Upload sessions carry object keys; only server-side code touches them.
drop policy if exists image_upload_sessions_select on public.image_upload_sessions;
create policy image_upload_sessions_select on public.image_upload_sessions
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- case notes
-- ---------------------------------------------------------------------------
drop policy if exists case_notes_select on public.case_notes;
create policy case_notes_select on public.case_notes
  for select to authenticated
  using (public.is_active_user());

drop policy if exists case_notes_insert on public.case_notes;
create policy case_notes_insert on public.case_notes
  for insert to authenticated
  with check (public.can_write_clinical() and public.case_is_writable(case_id));

drop policy if exists case_notes_update on public.case_notes;
create policy case_notes_update on public.case_notes
  for update to authenticated
  using (public.can_write_clinical() and public.case_is_writable(case_id))
  with check (public.can_write_clinical() and public.case_is_writable(case_id));

drop policy if exists case_changes_select on public.case_changes_performed;
create policy case_changes_select on public.case_changes_performed
  for select to authenticated
  using (public.is_active_user());

drop policy if exists case_changes_write on public.case_changes_performed;
create policy case_changes_write on public.case_changes_performed
  for all to authenticated
  using (public.can_write_clinical() and public.case_is_writable(case_id))
  with check (public.can_write_clinical() and public.case_is_writable(case_id));

-- ---------------------------------------------------------------------------
-- consent
-- ---------------------------------------------------------------------------
drop policy if exists case_consents_select on public.case_consents;
create policy case_consents_select on public.case_consents
  for select to authenticated
  using (public.is_active_user());

drop policy if exists case_consents_insert on public.case_consents;
create policy case_consents_insert on public.case_consents
  for insert to authenticated
  with check (public.can_manage_cases() and public.case_is_writable(case_id));

-- Update/delete are additionally blocked by trigger; no policy is granted.

-- ---------------------------------------------------------------------------
-- expert review
-- ---------------------------------------------------------------------------
drop policy if exists case_reviews_select on public.case_reviews;
create policy case_reviews_select on public.case_reviews
  for select to authenticated
  using (public.is_active_user());

drop policy if exists case_reviews_update on public.case_reviews;
create policy case_reviews_update on public.case_reviews
  for update to authenticated
  using (public.has_role(array['ADMIN', 'SURGEON']) and public.case_is_writable(case_id))
  with check (public.has_role(array['ADMIN', 'SURGEON']) and public.case_is_writable(case_id));

drop policy if exists case_review_revisions_select on public.case_review_revisions;
create policy case_review_revisions_select on public.case_review_revisions
  for select to authenticated
  using (public.is_active_user());

drop policy if exists case_review_revisions_insert on public.case_review_revisions;
create policy case_review_revisions_insert on public.case_review_revisions
  for insert to authenticated
  with check (public.has_role(array['ADMIN', 'SURGEON']));

-- ---------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (public.is_admin());

drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (public.is_active_user() and actor_user_id = auth.uid());

-- Update/delete are blocked by trigger and have no policy.

-- ---------------------------------------------------------------------------
-- Baseline grants. RLS narrows these further; anon gets nothing.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
