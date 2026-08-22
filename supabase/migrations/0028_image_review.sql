-- AURA Clinical Data Library
-- 0028: administrator review of submitted clinical images.
--
-- Submitting a phase already locks it and notifies the administrators. What was
-- missing is the other half: the administrator looking at the six photographs
-- and saying, per image, "this one is fine" or "retake this one, it is out of
-- frame". Without it, a locked phase means "somebody uploaded something", not
-- "somebody competent looked at it".
--
-- Design notes:
--
--   Per image, not per phase. A retake request names the specific view and
--   carries a reason, so the doctor knows which photograph to take again and
--   why. Approving five and rejecting one must not disturb the five.
--
--   The review status IS the lock. A slot marked REPHOTO_REQUESTED is writable
--   again for that slot alone; every other slot in the phase stays closed. No
--   separate unlock flag to drift out of sync with the decision.
--
--   Any new image resets its own review. Replacing a photograph, removing one,
--   or marking a view unavailable puts that slot back to PENDING — a decision
--   made about an image the administrator can no longer see is not a decision.
--
--   Visit-level status is derived, never stored. Four booleans over the slot
--   rows cannot disagree with the slot rows.
--
-- Backfill: everything starts PENDING, including images on phases already
-- submitted. Marking them approved would be a lie — nobody has reviewed them —
-- and it would hide exactly the work this feature exists to prompt. Completion
-- percentages on existing cases drop until an administrator reviews them, which
-- is the honest reading of "these images are not signed off yet".

-- ---------------------------------------------------------------------------
-- 1. Review state on the image slot.
-- ---------------------------------------------------------------------------
alter table public.clinical_images
  add column if not exists review_status text not null default 'PENDING',
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table public.clinical_images
  drop constraint if exists clinical_images_review_status_allowed;
alter table public.clinical_images
  add constraint clinical_images_review_status_allowed
  check (review_status in ('PENDING', 'APPROVED', 'REPHOTO_REQUESTED'));

alter table public.clinical_images
  drop constraint if exists clinical_images_review_note_length;
alter table public.clinical_images
  add constraint clinical_images_review_note_length
  check (review_note is null or length(review_note) <= 500);

-- A retake request without a reason is not actionable.
alter table public.clinical_images
  drop constraint if exists clinical_images_rephoto_needs_note;
alter table public.clinical_images
  add constraint clinical_images_rephoto_needs_note
  check (review_status <> 'REPHOTO_REQUESTED' or coalesce(btrim(review_note), '') <> '');

create index if not exists clinical_images_review_status_idx
  on public.clinical_images (visit_id, review_status);

-- ---------------------------------------------------------------------------
-- 2. Derived phase-level status.
--
--   NOT_SUBMITTED      the doctor has not sent it for review yet
--   PENDING            submitted, waiting on the administrator
--   CHANGES_REQUESTED  at least one view needs retaking
--   APPROVED           every standard view resolved and signed off
-- ---------------------------------------------------------------------------
create or replace function public.visit_image_review_status(p_visit_id uuid)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with v as (
    select images_locked_at from public.case_visits where id = p_visit_id
  ),
  standard as (
    select count(*)::int as n from public.image_view_types where is_standard and is_active
  ),
  slots as (
    select
      count(*) filter (where availability_status in ('UPLOADED', 'NOT_AVAILABLE'))::int as resolved,
      count(*) filter (where review_status = 'APPROVED')::int as approved,
      count(*) filter (where review_status = 'REPHOTO_REQUESTED')::int as rejected
    from public.clinical_images
    where visit_id = p_visit_id
  )
  select case
    when (select images_locked_at from v) is null then 'NOT_SUBMITTED'
    when (select rejected from slots) > 0 then 'CHANGES_REQUESTED'
    when (select resolved from slots) >= (select n from standard)
     and (select approved from slots) >= (select n from standard) then 'APPROVED'
    else 'PENDING'
  end;
$$;

grant execute on function public.visit_image_review_status(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Notify one specific person.
--
-- `notify_admins` fans out to administrators. Review feedback travels the other
-- way — to whoever took the photographs — so it needs its own helper.
-- ---------------------------------------------------------------------------
create or replace function public.notify_user(
  p_recipient uuid,
  p_type text,
  p_title text,
  p_body text,
  p_case_id uuid,
  p_visit_id uuid,
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
  -- Telling somebody about their own action is noise.
  if p_recipient is null or p_recipient is not distinct from p_actor then
    return 0;
  end if;

  insert into public.notifications (
    recipient_id, type, title, body, case_id, visit_id, actor_id
  )
  select p_recipient, p_type, p_title, p_body, p_case_id, p_visit_id, p_actor
  from public.profiles p
  where p.id = p_recipient and p.is_active;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.notify_user(uuid, text, text, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.notify_user(uuid, text, text, text, uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Record a review.
--
-- One call for the whole phase: the administrator ticks their way down the six
-- cards and sends once. Atomic, so a phase is never half-reviewed, and one
-- notification rather than six.
-- ---------------------------------------------------------------------------
create or replace function public.review_visit_images(
  p_visit_id uuid,
  p_decisions jsonb,
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
  v_actor_role text;
  v_actor_name text;
  v_decision jsonb;
  v_image public.clinical_images;
  v_approved integer := 0;
  v_rejected integer := 0;
  v_phase text;
  v_status text;
  v_recipient uuid;
begin
  select r.code into v_actor_role
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = p_actor and p.is_active;

  -- Enforced here as well as in the server action: the review is the
  -- administrator's, and a privileged function must not rely on its caller.
  if v_actor_role is distinct from 'ADMIN' then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select * into v_visit from public.case_visits where id = p_visit_id for update;
  if not found then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;

  if v_visit.images_locked_at is null then
    raise exception 'these images have not been submitted for review' using errcode = '22023';
  end if;

  select * into v_case from public.cases where id = v_visit.case_id;

  if v_case.archived_at is not null then
    raise exception 'this case is archived' using errcode = '22023';
  end if;

  for v_decision in select * from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb))
  loop
    select * into v_image
    from public.clinical_images
    where id = (v_decision ->> 'clinical_image_id')::uuid
    for update;

    if not found then
      raise exception 'image not found' using errcode = 'P0002';
    end if;

    -- An image from another visit must never be reachable through this call.
    if v_image.visit_id is distinct from p_visit_id then
      raise exception 'image does not belong to this visit' using errcode = '42501';
    end if;

    if (v_decision ->> 'status') not in ('APPROVED', 'REPHOTO_REQUESTED') then
      raise exception 'unknown review decision' using errcode = '22023';
    end if;

    update public.clinical_images
    set review_status = v_decision ->> 'status',
        review_note = nullif(btrim(coalesce(v_decision ->> 'note', '')), ''),
        reviewed_by = p_actor,
        reviewed_at = now()
    where id = v_image.id;

    if (v_decision ->> 'status') = 'APPROVED' then
      v_approved := v_approved + 1;
    else
      v_rejected := v_rejected + 1;
    end if;
  end loop;

  select public.visit_image_review_status(p_visit_id) into v_status;
  select display_name into v_actor_name from public.profiles where id = p_actor;

  v_phase := case
    when v_visit.visit_type = 'BEFORE' then 'Before'
    when v_visit.visit_type = 'AFTER' then 'After'
    else 'Follow-up (' || v_visit.display_label || ')'
  end;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor,
    case when v_rejected > 0 then 'IMAGE_REPHOTO_REQUESTED' else 'VISIT_IMAGES_APPROVED' end,
    'case_visit',
    p_visit_id,
    v_visit.case_id,
    jsonb_build_object(
      'visit_type', v_visit.visit_type,
      'phase', v_phase,
      'approved', v_approved,
      'rephoto_requested', v_rejected,
      'review_status', v_status
    )
  );

  -- Everyone who contributed a photograph to this phase hears the outcome. The
  -- notification carries the case number and the phase, never the reason text,
  -- which can name clinical detail.
  for v_recipient in
    select distinct ver.uploaded_by
    from public.clinical_images i
    join public.clinical_image_versions ver on ver.id = i.current_version_id
    where i.visit_id = p_visit_id and ver.uploaded_by is not null
  loop
    perform public.notify_user(
      v_recipient,
      case when v_rejected > 0 then 'VISIT_IMAGES_REPHOTO_REQUESTED' else 'VISIT_IMAGES_APPROVED' end,
      case
        when v_rejected > 0
          then v_phase || ' images need a retake — ' || v_case.case_number
        else v_phase || ' images approved — ' || v_case.case_number
      end,
      case
        when v_rejected > 0
          then coalesce(v_actor_name, 'An administrator') || ' asked for ' || v_rejected
               || ' view' || (case when v_rejected = 1 then '' else 's' end)
               || ' to be taken again.'
        else coalesce(v_actor_name, 'An administrator') || ' approved this phase.'
      end,
      v_visit.case_id,
      p_visit_id,
      p_actor
    );
  end loop;

  return v_visit;
end;
$$;

revoke all on function public.review_visit_images(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.review_visit_images(uuid, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. A changed image is an unreviewed image.
--
-- `finalize_image_upload` is re-declared in full because a replacement must
-- clear the decision attached to the photograph it replaced. Identical to the
-- 0005 definition apart from the three review columns in the slot UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_image_upload(
  p_session_id uuid,
  p_file_size bigint,
  p_sha256 text,
  p_actor uuid default auth.uid()
)
returns public.clinical_image_versions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.image_upload_sessions;
  v_image public.clinical_images;
  v_previous public.clinical_image_versions;
  v_version public.clinical_image_versions;
  v_is_replacement boolean := false;
begin
  select * into v_session
  from public.image_upload_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'upload session not found' using errcode = 'P0002';
  end if;

  if v_session.status = 'FINALIZED' then
    select * into v_version
    from public.clinical_image_versions
    where id = v_session.clinical_image_version_id;
    return v_version;
  end if;

  if v_session.status <> 'PENDING' then
    raise exception 'upload session is not pending' using errcode = '22023';
  end if;

  select * into v_image
  from public.clinical_images
  where visit_id = v_session.visit_id
    and view_type_id = v_session.view_type_id
  for update;

  if not found then
    insert into public.clinical_images (case_id, visit_id, view_type_id, availability_status)
    values (v_session.case_id, v_session.visit_id, v_session.view_type_id, 'MISSING')
    returning * into v_image;
  end if;

  if v_image.current_version_id is not null then
    v_is_replacement := true;
    select * into v_previous
    from public.clinical_image_versions
    where id = v_image.current_version_id;
  end if;

  insert into public.clinical_image_versions (
    clinical_image_id, bucket, object_key, original_filename,
    mime_type, file_size, sha256, uploaded_by
  )
  values (
    v_image.id, v_session.bucket, v_session.object_key, v_session.original_filename,
    v_session.expected_mime_type, p_file_size, p_sha256, p_actor
  )
  returning * into v_version;

  if v_is_replacement then
    update public.clinical_image_versions
    set superseded_at = now(), superseded_by = p_actor
    where id = v_previous.id;
  end if;

  update public.clinical_images
  set current_version_id = v_version.id,
      availability_status = 'UPLOADED',
      not_available_reason = null,
      not_available_by = null,
      not_available_at = null,
      -- The new photograph has not been reviewed, whatever was decided about
      -- the one it replaced.
      review_status = 'PENDING',
      review_note = null,
      reviewed_by = null,
      reviewed_at = null
  where id = v_image.id;

  update public.image_upload_sessions
  set status = 'FINALIZED',
      finalized_at = now(),
      clinical_image_version_id = v_version.id
  where id = v_session.id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor,
    case when v_is_replacement then 'IMAGE_REPLACED' else 'IMAGE_UPLOADED' end,
    'clinical_image',
    v_image.id,
    v_session.case_id,
    jsonb_build_object(
      'visit_id', v_session.visit_id,
      'view_type_id', v_session.view_type_id,
      'version_id', v_version.id,
      'file_size', p_file_size,
      'mime_type', v_session.expected_mime_type,
      'superseded_version_id', v_previous.id
    )
  );

  return v_version;
end;
$$;

revoke all on function public.finalize_image_upload(uuid, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_image_upload(uuid, bigint, text, uuid) to service_role;

-- Emptying a slot or declaring a view unavailable also invalidates any decision
-- attached to it. Handled as a trigger so every path is covered, including the
-- two RPCs that write these columns directly.
create or replace function public.clinical_images_reset_review()
returns trigger
language plpgsql
as $$
begin
  if new.current_version_id is distinct from old.current_version_id
     or new.availability_status is distinct from old.availability_status then
    -- Unless this very statement is the review being recorded.
    if new.review_status is not distinct from old.review_status then
      new.review_status := 'PENDING';
      new.review_note := null;
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists clinical_images_reset_review on public.clinical_images;
create trigger clinical_images_reset_review
  before update on public.clinical_images
  for each row execute function public.clinical_images_reset_review();

-- ---------------------------------------------------------------------------
-- 6. Completion now means signed off, not merely present.
--
-- Identical to the 0014 definition apart from `before_images` / `after_images`,
-- which additionally require every standard view to be APPROVED, plus two new
-- fields the checklist uses to explain *why* an item is still outstanding.
-- ---------------------------------------------------------------------------
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
    select
      count(*) filter (where i.availability_status in ('UPLOADED', 'NOT_AVAILABLE'))::int as resolved,
      count(*) filter (where i.review_status = 'APPROVED')::int as approved
    from public.clinical_images i
    join before_visit bv on bv.id = i.visit_id
  ),
  after_visit as (
    select id from public.case_visits where case_id = p_case_id and visit_type = 'AFTER' limit 1
  ),
  after_slots as (
    select
      count(*) filter (where i.availability_status in ('UPLOADED', 'NOT_AVAILABLE'))::int as resolved,
      count(*) filter (where i.review_status = 'APPROVED')::int as approved
    from public.clinical_images i
    join after_visit av on av.id = i.visit_id
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
      coalesce((select resolved from before_slots), 0) >= (select n from standard_views)
      and coalesce((select approved from before_slots), 0) >= (select n from standard_views),
    'before_images_resolved', coalesce((select resolved from before_slots), 0),
    'before_images_approved', coalesce((select approved from before_slots), 0),
    'before_images_review',
      coalesce((select public.visit_image_review_status(id) from before_visit), 'NOT_SUBMITTED'),
    'after_images',
      coalesce((select resolved from after_slots), 0) >= (select n from standard_views)
      and coalesce((select approved from after_slots), 0) >= (select n from standard_views),
    'after_images_resolved', coalesce((select resolved from after_slots), 0),
    'after_images_approved', coalesce((select approved from after_slots), 0),
    'after_images_review',
      coalesce((select public.visit_image_review_status(id) from after_visit), 'NOT_SUBMITTED'),
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
