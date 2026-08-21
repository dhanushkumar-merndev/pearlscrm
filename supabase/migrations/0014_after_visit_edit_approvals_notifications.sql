-- AURA Clinical Data Library
-- 0014: the AFTER (post-operative) visit, admin edit-approval workflow, and
--       in-app notifications.
--
-- Three related changes:
--
--   1. A case now has three structural phases — BEFORE, AFTER and any number of
--      FOLLOW_UP visits. AFTER is created with the case, exactly like BEFORE.
--
--   2. Clinical records lock once they have been submitted. Re-editing a locked
--      scope requires an administrator to approve a written request first. The
--      grant is single-use: saving consumes it, so the next edit asks again.
--
--   3. Submissions and approval decisions raise in-app notifications so an
--      administrator sees that images have landed on a case without polling it.

-- ---------------------------------------------------------------------------
-- 1. AFTER visits
-- ---------------------------------------------------------------------------
alter table public.case_visits drop constraint if exists case_visits_type_allowed;
alter table public.case_visits
  add constraint case_visits_type_allowed
  check (visit_type in ('BEFORE', 'AFTER', 'FOLLOW_UP'));

-- Only one AFTER visit per case, mirroring the BEFORE rule.
create unique index if not exists case_visits_one_after_per_case
  on public.case_visits (case_id)
  where visit_type = 'AFTER';

-- Backfill: every existing case gains its AFTER phase.
insert into public.case_visits (case_id, visit_type, display_label, visit_date, created_by)
select c.id, 'AFTER', 'After', null, c.created_by
from public.cases c
where not exists (
  select 1 from public.case_visits v
  where v.case_id = c.id and v.visit_type = 'AFTER'
);

-- ---------------------------------------------------------------------------
-- 2. Submission locks
--
-- A NULL lock column means "never submitted" — the first pass through a scope
-- is always free. Once set, the scope is closed to everyone but an admin, or a
-- user holding an approved edit grant.
-- ---------------------------------------------------------------------------
alter table public.cases
  add column if not exists information_locked_at timestamptz;

alter table public.case_visits
  add column if not exists details_locked_at timestamptz,
  add column if not exists images_locked_at timestamptz;

-- Existing cases were submitted when they were created.
update public.cases set information_locked_at = created_at where information_locked_at is null;

-- Existing follow-ups were submitted when they were added; existing visits that
-- already hold clinical images count as submitted too.
update public.case_visits
set details_locked_at = created_at
where visit_type = 'FOLLOW_UP' and details_locked_at is null;

update public.case_visits v
set images_locked_at = now()
where images_locked_at is null
  and exists (
    select 1 from public.clinical_images i
    where i.visit_id = v.id and i.availability_status = 'UPLOADED'
  );

-- ---------------------------------------------------------------------------
-- 3. Edit requests
-- ---------------------------------------------------------------------------
create table if not exists public.case_edit_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  scope text not null,
  visit_id uuid references public.case_visits (id) on delete cascade,
  status text not null default 'PENDING',
  reason text not null,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_edit_requests_scope_allowed
    check (scope in ('CASE_INFORMATION', 'CASE_NOTES', 'VISIT_DETAILS', 'VISIT_IMAGES')),
  constraint case_edit_requests_status_allowed
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'CONSUMED', 'EXPIRED')),
  constraint case_edit_requests_visit_required
    check ((scope in ('CASE_INFORMATION', 'CASE_NOTES')) = (visit_id is null)),
  constraint case_edit_requests_reason_present
    check (btrim(reason) <> '' and length(reason) <= 1000),
  constraint case_edit_requests_note_length
    check (decision_note is null or length(decision_note) <= 1000)
);

create index if not exists case_edit_requests_case_idx
  on public.case_edit_requests (case_id, requested_at desc);
create index if not exists case_edit_requests_status_idx
  on public.case_edit_requests (status, requested_at desc);
create index if not exists case_edit_requests_requester_idx
  on public.case_edit_requests (requested_by, status);

-- One open request per user per scope: re-asking simply surfaces the pending one.
create unique index if not exists case_edit_requests_one_open_per_scope
  on public.case_edit_requests (requested_by, case_id, scope, coalesce(visit_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('PENDING', 'APPROVED');

drop trigger if exists case_edit_requests_set_updated_at on public.case_edit_requests;
create trigger case_edit_requests_set_updated_at
  before update on public.case_edit_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Notifications
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  case_id uuid references public.cases (id) on delete cascade,
  visit_id uuid references public.case_visits (id) on delete set null,
  edit_request_id uuid references public.case_edit_requests (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_type_length check (length(type) <= 80),
  constraint notifications_title_length check (length(title) <= 200),
  constraint notifications_body_length check (body is null or length(body) <= 1000)
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id) where read_at is null;

-- Fan-out helper. Notifications carry case numbers and labels only — never
-- clinical narrative, which belongs on the case and nowhere else.
create or replace function public.notify_admins(
  p_type text,
  p_title text,
  p_body text,
  p_case_id uuid,
  p_visit_id uuid,
  p_edit_request_id uuid,
  p_actor uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  insert into public.notifications (
    recipient_id, type, title, body, case_id, visit_id, edit_request_id, actor_id
  )
  select p.id, p_type, p_title, p_body, p_case_id, p_visit_id, p_edit_request_id, p_actor
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where r.code = 'ADMIN'
    and p.is_active
    -- An admin acting on their own case does not need to be told about it.
    and p.id is distinct from p_actor;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.notify_admins(text, text, text, uuid, uuid, uuid, uuid) from public;
grant execute on function public.notify_admins(text, text, text, uuid, uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Edit-grant lifecycle
-- ---------------------------------------------------------------------------

-- Spends an approval. Only a grant that is still APPROVED is consumed, so a
-- retried save cannot burn a second one, and a double call is harmless.
create or replace function public.consume_edit_grant(p_request_id uuid, p_actor uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.case_edit_requests;
begin
  if p_request_id is null then
    return;
  end if;

  update public.case_edit_requests
  set status = 'CONSUMED', consumed_at = now()
  where id = p_request_id and status = 'APPROVED'
  returning * into v_request;

  if not found then
    return;
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor, 'EDIT_REQUEST_CONSUMED', 'case_edit_request', v_request.id, v_request.case_id,
    jsonb_build_object('scope', v_request.scope, 'visit_id', v_request.visit_id)
  );
end;
$$;

revoke all on function public.consume_edit_grant(uuid, uuid) from public;
grant execute on function public.consume_edit_grant(uuid, uuid) to service_role;

-- Create a request. Atomic: insert + audit + notify every active admin.
create or replace function public.create_edit_request(
  p_case_id uuid,
  p_scope text,
  p_visit_id uuid,
  p_reason text,
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
  v_actor_name text;
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

  insert into public.case_edit_requests (case_id, scope, visit_id, reason, requested_by)
  values (p_case_id, p_scope, p_visit_id, btrim(p_reason), p_actor)
  returning * into v_request;

  v_scope_label := case
    when p_scope = 'CASE_INFORMATION' then 'case information'
    when p_scope = 'CASE_NOTES' then 'case notes'
    when p_scope = 'VISIT_DETAILS' then coalesce(v_visit.display_label, 'visit') || ' details'
    else coalesce(v_visit.display_label, 'visit') || ' images'
  end;

  select display_name into v_actor_name from public.profiles where id = p_actor;

  perform public.notify_admins(
    'EDIT_REQUEST_CREATED',
    'Edit approval requested for ' || v_case.case_number,
    coalesce(v_actor_name, 'A user') || ' asked to edit the ' || v_scope_label
      || ' on ' || v_case.case_number || '.',
    p_case_id,
    p_visit_id,
    v_request.id,
    p_actor
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor, 'EDIT_REQUEST_CREATED', 'case_edit_request', v_request.id, p_case_id,
    jsonb_build_object('scope', p_scope, 'visit_id', p_visit_id)
  );

  return v_request;
end;
$$;

revoke all on function public.create_edit_request(uuid, text, uuid, text, uuid) from public;
grant execute on function public.create_edit_request(uuid, text, uuid, text, uuid) to service_role;

-- Approve or reject. Atomic: decision + audit + notify the requester.
create or replace function public.decide_edit_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text,
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
  select * into v_request from public.case_edit_requests where id = p_request_id for update;

  if not found then
    raise exception 'edit request not found' using errcode = 'P0002';
  end if;

  if v_request.status <> 'PENDING' then
    raise exception 'this request has already been decided' using errcode = '22023';
  end if;

  select * into v_case from public.cases where id = v_request.case_id;

  if v_request.visit_id is not null then
    select * into v_visit from public.case_visits where id = v_request.visit_id;
  end if;

  update public.case_edit_requests
  set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
      decided_by = p_actor,
      decided_at = now(),
      decision_note = nullif(btrim(coalesce(p_note, '')), ''),
      expires_at = case
        when p_approve then now() + make_interval(hours => greatest(coalesce(p_ttl_hours, 168), 1))
        else null
      end
  where id = p_request_id
  returning * into v_request;

  v_scope_label := case
    when v_request.scope = 'CASE_INFORMATION' then 'case information'
    when v_request.scope = 'CASE_NOTES' then 'case notes'
    when v_request.scope = 'VISIT_DETAILS' then coalesce(v_visit.display_label, 'visit') || ' details'
    else coalesce(v_visit.display_label, 'visit') || ' images'
  end;

  select display_name into v_decider from public.profiles where id = p_actor;

  insert into public.notifications (
    recipient_id, type, title, body, case_id, visit_id, edit_request_id, actor_id
  )
  values (
    v_request.requested_by,
    case when p_approve then 'EDIT_REQUEST_APPROVED' else 'EDIT_REQUEST_REJECTED' end,
    case when p_approve then 'Edit approved on ' || v_case.case_number
         else 'Edit request declined on ' || v_case.case_number end,
    case when p_approve
      then coalesce(v_decider, 'An administrator') || ' approved your request to edit the '
           || v_scope_label || '. The approval is single use — saving your changes closes it.'
      else coalesce(v_decider, 'An administrator') || ' declined your request to edit the '
           || v_scope_label || '.'
    end
      || coalesce(' Note: ' || v_request.decision_note, ''),
    v_request.case_id,
    v_request.visit_id,
    v_request.id,
    p_actor
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor,
    case when p_approve then 'EDIT_REQUEST_APPROVED' else 'EDIT_REQUEST_REJECTED' end,
    'case_edit_request', v_request.id, v_request.case_id,
    jsonb_build_object(
      'scope', v_request.scope,
      'visit_id', v_request.visit_id,
      'requested_by', v_request.requested_by,
      'expires_at', v_request.expires_at
    )
  );

  return v_request;
end;
$$;

revoke all on function public.decide_edit_request(uuid, boolean, text, integer, uuid) from public;
grant execute on function public.decide_edit_request(uuid, boolean, text, integer, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Batch image submission
--
-- Staged images are uploaded one object at a time, but the *submission* is a
-- single clinical act: it closes the visit for editing, consumes any edit grant
-- that was in play, and tells the administrators once rather than six times.
-- ---------------------------------------------------------------------------
create or replace function public.submit_visit_images(
  p_visit_id uuid,
  p_grant_id uuid,
  p_actor uuid
)
returns public.case_visits
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_visit public.case_visits;
  v_case public.cases;
  v_uploaded integer;
  v_unavailable integer;
  v_standard integer;
  v_actor_name text;
  v_phase text;
  v_was_locked boolean;
begin
  select * into v_visit from public.case_visits where id = p_visit_id for update;

  if not found then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;

  select * into v_case from public.cases where id = v_visit.case_id;

  v_was_locked := v_visit.images_locked_at is not null;

  select
    count(*) filter (where availability_status = 'UPLOADED'),
    count(*) filter (where availability_status = 'NOT_AVAILABLE')
  into v_uploaded, v_unavailable
  from public.clinical_images
  where visit_id = p_visit_id;

  select count(*)::int into v_standard
  from public.image_view_types where is_standard and is_active;

  update public.case_visits
  set images_locked_at = now()
  where id = p_visit_id
  returning * into v_visit;

  perform public.consume_edit_grant(p_grant_id, p_actor);

  select display_name into v_actor_name from public.profiles where id = p_actor;

  v_phase := case
    when v_visit.visit_type = 'BEFORE' then 'Before'
    when v_visit.visit_type = 'AFTER' then 'After'
    else 'Follow-up (' || v_visit.display_label || ')'
  end;

  perform public.notify_admins(
    case when v_was_locked then 'VISIT_IMAGES_UPDATED' else 'VISIT_IMAGES_SUBMITTED' end,
    v_phase || ' images ' || (case when v_was_locked then 'updated' else 'submitted' end)
      || ' — ' || v_case.case_number,
    coalesce(v_actor_name, 'A user') || ' saved ' || v_uploaded || ' of ' || v_standard
      || ' standard views for ' || v_phase || ' on ' || v_case.case_number
      || case when v_unavailable > 0
              then ' (' || v_unavailable || ' marked not available).'
              else '.' end,
    v_visit.case_id,
    v_visit.id,
    null,
    p_actor
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor,
    case when v_was_locked then 'VISIT_IMAGES_UPDATED' else 'VISIT_IMAGES_SUBMITTED' end,
    'case_visit', v_visit.id, v_visit.case_id,
    jsonb_build_object(
      'visit_type', v_visit.visit_type,
      'display_label', v_visit.display_label,
      'uploaded_count', v_uploaded,
      'not_available_count', v_unavailable,
      'standard_view_count', v_standard
    )
  );

  return v_visit;
end;
$$;

revoke all on function public.submit_visit_images(uuid, uuid, uuid) from public;
grant execute on function public.submit_visit_images(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Removing an image from a slot
--
-- "Delete" in the editing UI empties the *slot*. The stored original and its
-- version record are retained and simply marked superseded — a clinical
-- original is never destroyed.
-- ---------------------------------------------------------------------------
create or replace function public.remove_current_image(
  p_clinical_image_id uuid,
  p_actor uuid
)
returns public.clinical_images
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_image public.clinical_images;
  v_version_id uuid;
begin
  select * into v_image from public.clinical_images where id = p_clinical_image_id for update;

  if not found then
    raise exception 'image not found' using errcode = 'P0002';
  end if;

  if v_image.current_version_id is null then
    return v_image;
  end if;

  v_version_id := v_image.current_version_id;

  update public.clinical_images
  set current_version_id = null,
      availability_status = 'MISSING'
  where id = v_image.id
  returning * into v_image;

  update public.clinical_image_versions
  set superseded_at = coalesce(superseded_at, now()), superseded_by = p_actor
  where id = v_version_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor, 'IMAGE_REMOVED', 'clinical_image', v_image.id, v_image.case_id,
    jsonb_build_object(
      'visit_id', v_image.visit_id,
      'view_type_id', v_image.view_type_id,
      'removed_version_id', v_version_id
    )
  );

  return v_image;
end;
$$;

revoke all on function public.remove_current_image(uuid, uuid) from public;
grant execute on function public.remove_current_image(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. create_case — now also opens the AFTER phase and locks case information.
-- ---------------------------------------------------------------------------
create or replace function public.create_case(
  p_procedure_id uuid,
  p_procedure_type_id uuid,
  p_surgery_date date,
  p_followup_availability text default null,
  p_tag_ids uuid[] default '{}',
  p_actor uuid default auth.uid()
)
returns public.cases
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.cases;
  v_number text;
  v_tag uuid;
begin
  v_number := public.next_case_number();

  insert into public.cases (
    case_number, procedure_id, procedure_type_id, surgery_date,
    followup_availability, created_by, information_locked_at
  )
  values (
    v_number, p_procedure_id, p_procedure_type_id, p_surgery_date,
    nullif(btrim(coalesce(p_followup_availability, '')), ''), p_actor,
    -- The create form is itself a submission: changing these details later
    -- goes through the approval workflow.
    now()
  )
  returning * into v_case;

  -- BEFORE and AFTER always exist for a case; their image slots are created
  -- lazily as they are uploaded or marked unavailable.
  insert into public.case_visits (case_id, visit_type, display_label, visit_date, created_by)
  values
    (v_case.id, 'BEFORE', 'Before', p_surgery_date, p_actor),
    (v_case.id, 'AFTER', 'After', null, p_actor);

  foreach v_tag in array coalesce(p_tag_ids, '{}')
  loop
    insert into public.case_tags (case_id, tag_id, created_by)
    values (v_case.id, v_tag, p_actor)
    on conflict do nothing;
  end loop;

  update public.procedures set usage_count = usage_count + 1 where id = p_procedure_id;
  update public.procedure_types set usage_count = usage_count + 1 where id = p_procedure_type_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor, 'CASE_CREATED', 'case', v_case.id, v_case.id,
    jsonb_build_object(
      'case_number', v_case.case_number,
      'procedure_id', p_procedure_id,
      'procedure_type_id', p_procedure_type_id,
      'surgery_date', p_surgery_date
    )
  );

  return v_case;
end;
$$;

revoke all on function public.create_case(uuid, uuid, date, text, uuid[], uuid) from public;
grant execute on function public.create_case(uuid, uuid, date, text, uuid[], uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Read models refreshed for the AFTER phase.
-- ---------------------------------------------------------------------------
drop view if exists public.case_list_view;

create or replace view public.case_list_view
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
    as standard_view_count
from public.cases c
join public.procedures p on p.id = c.procedure_id
join public.procedure_types pt on pt.id = c.procedure_type_id
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
) aft on true;

grant select on public.case_list_view to authenticated, service_role;

-- Completion now reports the AFTER phase alongside BEFORE. After images are an
-- informational signal rather than a required item: a case can be clinically
-- reviewed before its post-operative set is complete.
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
    select count(*)::int as resolved
    from public.clinical_images i
    join before_visit bv on bv.id = i.visit_id
    where i.availability_status in ('UPLOADED', 'NOT_AVAILABLE')
  ),
  after_visit as (
    select id from public.case_visits where case_id = p_case_id and visit_type = 'AFTER' limit 1
  ),
  after_slots as (
    select count(*)::int as resolved
    from public.clinical_images i
    join after_visit av on av.id = i.visit_id
    where i.availability_status in ('UPLOADED', 'NOT_AVAILABLE')
  ),
  followups as (
    select count(*)::int as n from public.case_visits
    where case_id = p_case_id and visit_type = 'FOLLOW_UP'
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
    'case_information',
      (select surgery_date is not null and procedure_id is not null
              and procedure_type_id is not null from c),
    'before_images',
      coalesce((select resolved from before_slots), 0) >= (select n from standard_views),
    'before_images_resolved', coalesce((select resolved from before_slots), 0),
    'after_images',
      coalesce((select resolved from after_slots), 0) >= (select n from standard_views),
    'after_images_resolved', coalesce((select resolved from after_slots), 0),
    'standard_view_count', (select n from standard_views),
    'followups', coalesce((select n from followups), 0) > 0,
    'followup_count', coalesce((select n from followups), 0),
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
-- 10. RLS for the new tables.
--
-- Both are written exclusively by server-side privileged code, so neither gets
-- an INSERT policy for `authenticated`. Reads are scoped to the people the row
-- concerns.
-- ---------------------------------------------------------------------------
alter table public.case_edit_requests enable row level security;
alter table public.case_edit_requests force row level security;
alter table public.notifications enable row level security;
alter table public.notifications force row level security;

drop policy if exists case_edit_requests_select on public.case_edit_requests;
create policy case_edit_requests_select on public.case_edit_requests
  for select to authenticated
  using (public.is_active_user() and (public.is_admin() or requested_by = auth.uid()));

-- Withdrawing your own pending request is the only client-side write.
drop policy if exists case_edit_requests_cancel_own on public.case_edit_requests;
create policy case_edit_requests_cancel_own on public.case_edit_requests
  for update to authenticated
  using (requested_by = auth.uid() and status = 'PENDING' and public.is_active_user())
  with check (requested_by = auth.uid() and status in ('PENDING', 'CANCELLED'));

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (recipient_id = auth.uid() and public.is_active_user());

drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications
  for update to authenticated
  using (recipient_id = auth.uid() and public.is_active_user())
  with check (recipient_id = auth.uid());

-- Explicit grants rather than relying on the schema's default privileges. RLS
-- narrows these; anon gets nothing at all.
grant select, update on public.case_edit_requests to authenticated;
grant select, insert, update, delete on public.case_edit_requests to service_role;

grant select, update on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;

revoke all on public.case_edit_requests from anon;
revoke all on public.notifications from anon;

-- ---------------------------------------------------------------------------
-- 11. Column guards for the two client-writable policies above.
--
-- The UPDATE policies exist for exactly two actions: a requester withdrawing
-- their own pending request, and a recipient marking their own notification
-- read. `current_user` is `authenticated` only for a direct client write —
-- privileged server code arrives through SECURITY DEFINER functions or the
-- service role — so the guards narrow those policies to those two actions
-- without constraining anything the server does.
-- ---------------------------------------------------------------------------
create or replace function public.case_edit_requests_client_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if old.status <> 'PENDING' or new.status <> 'CANCELLED' then
    raise exception 'a pending request may only be withdrawn';
  end if;

  if new.case_id is distinct from old.case_id
     or new.scope is distinct from old.scope
     or new.visit_id is distinct from old.visit_id
     or new.reason is distinct from old.reason
     or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at
     or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at
     or new.decision_note is distinct from old.decision_note
     or new.expires_at is distinct from old.expires_at
     or new.consumed_at is distinct from old.consumed_at then
    raise exception 'only the status of a pending request may be changed';
  end if;

  return new;
end;
$$;

drop trigger if exists case_edit_requests_client_guard on public.case_edit_requests;
create trigger case_edit_requests_client_guard
  before update on public.case_edit_requests
  for each row execute function public.case_edit_requests_client_guard();

create or replace function public.notifications_client_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.recipient_id is distinct from old.recipient_id
     or new.type is distinct from old.type
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.case_id is distinct from old.case_id
     or new.visit_id is distinct from old.visit_id
     or new.edit_request_id is distinct from old.edit_request_id
     or new.actor_id is distinct from old.actor_id
     or new.created_at is distinct from old.created_at then
    raise exception 'only the read state of a notification may be changed';
  end if;

  -- Read is a one-way transition: a notification cannot be un-read.
  if new.read_at is null and old.read_at is not null then
    raise exception 'a notification cannot be marked unread';
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_client_guard on public.notifications;
create trigger notifications_client_guard
  before update on public.notifications
  for each row execute function public.notifications_client_guard();

-- Notifications are per-recipient copies; deleting someone else's is not a
-- capability anyone needs, and there is no DELETE policy granting it.
