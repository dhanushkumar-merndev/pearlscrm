-- AURA Clinical Data Library
-- 0015: the expert review becomes administrator-only, and an approval can grant
--       more than the one scope that was asked for.

-- ---------------------------------------------------------------------------
-- 1. The expert review is Dr. Praveen's, and Dr. Praveen holds the ADMIN role.
--
-- Reviews stay readable to every active user — the case header and completion
-- checklist show whether a case has been signed off — but only an administrator
-- may write one. A case cannot be completed until that review exists, which
-- makes closing a case an administrator's decision by construction.
-- ---------------------------------------------------------------------------
drop policy if exists case_reviews_update on public.case_reviews;
create policy case_reviews_update on public.case_reviews
  for update to authenticated
  using (public.is_admin() and public.case_is_writable(case_id))
  with check (public.is_admin() and public.case_is_writable(case_id));

drop policy if exists case_review_revisions_insert on public.case_review_revisions;
create policy case_review_revisions_insert on public.case_review_revisions
  for insert to authenticated
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Granting a scope directly.
--
-- When an administrator approves a request they may hand over neighbouring
-- sections in the same decision — a wrong photograph is rarely confined to one
-- phase. Each extra scope becomes its own APPROVED grant, so each is spent by
-- its own save and shows up separately in the audit trail.
--
-- Returns the grant, or null when the user already holds an open request for
-- that scope (which is left alone rather than duplicated).
-- ---------------------------------------------------------------------------
create or replace function public.grant_edit_access(
  p_case_id uuid,
  p_scope text,
  p_visit_id uuid,
  p_user uuid,
  p_reason text,
  p_ttl_hours integer,
  p_actor uuid
)
returns public.case_edit_requests
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.case_edit_requests;
  v_case public.cases;
  v_visit public.case_visits;
  v_scope_label text;
  v_decider text;
begin
  select * into v_case from public.cases where id = p_case_id;
  if not found then
    raise exception 'case not found' using errcode = 'P0002';
  end if;

  if p_visit_id is not null then
    select * into v_visit from public.case_visits where id = p_visit_id;
    if not found or v_visit.case_id <> p_case_id then
      raise exception 'visit not found for this case' using errcode = 'P0002';
    end if;
  end if;

  -- Already pending or approved for this user: leave it be.
  if exists (
    select 1 from public.case_edit_requests r
    where r.case_id = p_case_id
      and r.scope = p_scope
      and r.requested_by = p_user
      and r.visit_id is not distinct from p_visit_id
      and r.status in ('PENDING', 'APPROVED')
  ) then
    return null;
  end if;

  insert into public.case_edit_requests (
    case_id, scope, visit_id, status, reason, requested_by,
    decided_by, decided_at, expires_at
  )
  values (
    p_case_id, p_scope, p_visit_id, 'APPROVED', btrim(p_reason), p_user,
    p_actor, now(), now() + make_interval(hours => greatest(coalesce(p_ttl_hours, 168), 1))
  )
  returning * into v_request;

  v_scope_label := case
    when p_scope = 'CASE_INFORMATION' then 'case information'
    when p_scope = 'CASE_NOTES' then 'case notes'
    when p_scope = 'VISIT_DETAILS' then coalesce(v_visit.display_label, 'visit') || ' details'
    else coalesce(v_visit.display_label, 'visit') || ' images'
  end;

  select display_name into v_decider from public.profiles where id = p_actor;

  insert into public.notifications (
    recipient_id, type, title, body, case_id, visit_id, edit_request_id, actor_id
  )
  values (
    p_user,
    'EDIT_ACCESS_GRANTED',
    'Edit access granted on ' || v_case.case_number,
    coalesce(v_decider, 'An administrator') || ' also opened the ' || v_scope_label
      || ' on ' || v_case.case_number
      || ' for editing. Each approval is single use — saving closes it.',
    p_case_id,
    p_visit_id,
    v_request.id,
    p_actor
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor, 'EDIT_ACCESS_GRANTED', 'case_edit_request', v_request.id, p_case_id,
    jsonb_build_object(
      'scope', p_scope,
      'visit_id', p_visit_id,
      'granted_to', p_user,
      'expires_at', v_request.expires_at
    )
  );

  return v_request;
end;
$$;

revoke all on function public.grant_edit_access(uuid, text, uuid, uuid, text, integer, uuid)
  from public;
grant execute on function public.grant_edit_access(uuid, text, uuid, uuid, text, integer, uuid)
  to service_role;
