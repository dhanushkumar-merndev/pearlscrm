-- Restrict doctors to cases they created or were explicitly assigned.
-- Administrators retain access to every case. Existing Viewer behaviour is
-- preserved; case_viewer_access is reused as the established assignment table.

begin;

-- The old access model treated ALL as a shortcut for every clinical user.
-- Doctors are always selected-case users under the new role model.
update public.profiles p
set case_visibility_scope = 'SELECTED'
from public.roles r
where r.id = p.role_id
  and r.code = 'DOCTOR'
  and p.case_visibility_scope is distinct from 'SELECTED';

create or replace function public.case_is_visible(p_case_id uuid)
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
          select 1
          from public.cases c
          where c.id = p_case_id
            and (
              c.created_by = auth.uid()
              or exists (
                select 1
                from public.case_viewer_access a
                where a.case_id = c.id
                  and a.user_id = auth.uid()
              )
            )
        )
      )
      or (
        public.current_role_code() = 'VIEWER'
        and (
          exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and p.case_visibility_scope = 'ALL'
          )
          or exists (
            select 1
            from public.case_viewer_access a
            where a.case_id = p_case_id
              and a.user_id = auth.uid()
          )
        )
      )
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
    or (
      public.current_role_code() = 'DOCTOR'
      and public.case_is_visible(p_case_id)
    );
$$;

create or replace function public.case_is_writable(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.case_is_visible(p_case_id)
    and exists (
      select 1
      from public.cases c
      where c.id = p_case_id
        and (c.archived_at is null or public.is_admin())
    );
$$;

revoke all on function public.case_is_visible(uuid) from public;
revoke all on function public.case_is_owned_or_admin(uuid) from public;
revoke all on function public.case_is_writable(uuid) from public;
grant execute on function public.case_is_visible(uuid) to authenticated, service_role;
grant execute on function public.case_is_owned_or_admin(uuid) to authenticated, service_role;
grant execute on function public.case_is_writable(uuid) to authenticated, service_role;

-- The case view is security_invoker, so this policy scopes the Cases page and
-- every Dashboard query without duplicating filters in application code.
drop policy if exists cases_select on public.cases;
create policy cases_select on public.cases
  for select to authenticated
  using (public.case_is_visible(id));

drop policy if exists cases_update on public.cases;
create policy cases_update on public.cases
  for update to authenticated
  using (public.can_manage_cases() and public.case_is_writable(id))
  with check (public.can_manage_cases() and public.case_is_visible(id));

-- Apply the same boundary to every case-owned clinical record. This prevents a
-- doctor from bypassing the Cases page and querying another case's child rows.
drop policy if exists case_tags_select on public.case_tags;
create policy case_tags_select on public.case_tags
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists case_visits_select on public.case_visits;
create policy case_visits_select on public.case_visits
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists clinical_images_select on public.clinical_images;
create policy clinical_images_select on public.clinical_images
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists clinical_image_versions_select on public.clinical_image_versions;
create policy clinical_image_versions_select on public.clinical_image_versions
  for select to authenticated
  using (
    exists (
      select 1
      from public.clinical_images i
      where i.id = clinical_image_id
        and public.case_is_visible(i.case_id)
    )
  );

drop policy if exists case_notes_select on public.case_notes;
create policy case_notes_select on public.case_notes
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists case_changes_select on public.case_changes_performed;
create policy case_changes_select on public.case_changes_performed
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists case_consents_select on public.case_consents;
create policy case_consents_select on public.case_consents
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists case_reviews_select on public.case_reviews;
create policy case_reviews_select on public.case_reviews
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists case_review_revisions_select on public.case_review_revisions;
create policy case_review_revisions_select on public.case_review_revisions
  for select to authenticated
  using (public.case_is_visible(case_id));

-- Atomic administrator operation used by the case access dialog. It replaces
-- Doctor assignments only and deliberately leaves any Viewer grants untouched.
create or replace function public.set_case_access(
  p_case_id uuid,
  p_user_ids uuid[],
  p_actor uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_ids uuid[] := coalesce(p_user_ids, array[]::uuid[]);
begin
  if not exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = p_actor
      and p.is_active
      and r.code = 'ADMIN'
  ) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  if not exists (select 1 from public.cases c where c.id = p_case_id) then
    raise exception 'case not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from unnest(v_user_ids) requested(id)
    left join public.profiles p on p.id = requested.id and p.is_active
    left join public.roles r on r.id = p.role_id
    where p.id is null or r.code not in ('DOCTOR', 'VIEWER')
  ) then
    raise exception 'every assignee must be an active Doctor or Viewer' using errcode = '22023';
  end if;

  delete from public.case_viewer_access a
  using public.profiles p, public.roles r
  where a.case_id = p_case_id
    and a.user_id = p.id
    and p.role_id = r.id
    and r.code in ('DOCTOR', 'VIEWER');

  insert into public.case_viewer_access (case_id, user_id, granted_by)
  select p_case_id, requested.id, p_actor
  from (select distinct unnest(v_user_ids) as id) requested
  on conflict (case_id, user_id) do update
    set granted_by = excluded.granted_by,
        granted_at = now();

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, case_id, metadata
  )
  values (
    p_actor,
    'CASE_ACCESS_UPDATED',
    'case',
    p_case_id,
    p_case_id,
    jsonb_build_object(
      'assigned_user_count', cardinality(v_user_ids),
      'assigned_user_ids', to_jsonb(v_user_ids)
    )
  );
end;
$$;

revoke all on function public.set_case_access(uuid, uuid[], uuid) from public;
grant execute on function public.set_case_access(uuid, uuid[], uuid) to service_role;

commit;
