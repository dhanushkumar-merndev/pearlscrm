-- AURA Clinical Data Library
-- 0030: a retake request survives the retake.
--
-- 0028 reset a slot to PENDING as soon as a new photograph landed, on the
-- reasoning that a decision about an image the administrator can no longer see
-- is not a decision. That is right for an APPROVED slot. It is wrong for a
-- REPHOTO_REQUESTED one, and it broke the flow it was meant to support:
--
--   1. administrator asks for Right 45 to be retaken
--   2. doctor uploads the new photograph  -> slot resets to PENDING
--   3. doctor presses Save                -> the phase is still locked, and the
--                                            retake flag that authorised them
--                                            is gone, so the submit demands an
--                                            edit grant
--
-- And a refresh between 2 and 3 left them with a locked phase, no outstanding
-- retake, and no way back in at all.
--
-- The correct rule: a retake request is an outstanding instruction, and it
-- stands until the phase is re-submitted for review. It is what keeps the slot
-- open, what keeps the reason on screen while the doctor works, and what tells
-- the submit path no grant is needed. `submit_visit_images` clears it, which is
-- exactly the moment the administrator is asked to look again.

-- ---------------------------------------------------------------------------
-- 1. The trigger no longer clears an outstanding retake request.
-- ---------------------------------------------------------------------------
create or replace function public.clinical_images_reset_review()
returns trigger
language plpgsql
as $$
begin
  if new.current_version_id is distinct from old.current_version_id
     or new.availability_status is distinct from old.availability_status then
    -- Unless this very statement is the review being recorded.
    if new.review_status is not distinct from old.review_status then
      -- An outstanding retake request stands until the phase is re-submitted:
      -- it is the doctor's instruction and their authorisation to act on it.
      if old.review_status is distinct from 'REPHOTO_REQUESTED' then
        new.review_status := 'PENDING';
        new.review_note := null;
        new.reviewed_by := null;
        new.reviewed_at := null;
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Finalizing an upload leaves a retake request alone.
--
-- Identical to 0028 apart from the slot UPDATE, which now preserves
-- REPHOTO_REQUESTED instead of overwriting it.
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
      -- A retake request stands until the phase goes back for review; anything
      -- else is invalidated by the new photograph.
      review_status = case
        when v_image.review_status = 'REPHOTO_REQUESTED' then 'REPHOTO_REQUESTED'
        else 'PENDING'
      end,
      review_note = case
        when v_image.review_status = 'REPHOTO_REQUESTED' then v_image.review_note
        else null
      end,
      reviewed_by = case
        when v_image.review_status = 'REPHOTO_REQUESTED' then v_image.reviewed_by
        else null
      end,
      reviewed_at = case
        when v_image.review_status = 'REPHOTO_REQUESTED' then v_image.reviewed_at
        else null
      end
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
      'superseded_version_id', v_previous.id,
      'was_retake', v_image.review_status = 'REPHOTO_REQUESTED'
    )
  );

  return v_version;
end;
$$;

revoke all on function public.finalize_image_upload(uuid, bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_image_upload(uuid, bigint, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Re-submitting clears the outstanding retakes.
--
-- This is the moment the instruction has been carried out and the phase goes
-- back to the administrator, so every REPHOTO_REQUESTED slot returns to
-- PENDING. Approved slots are untouched — they were never in question.
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
  v_actor_name text;
  v_phase text;
  v_was_locked boolean;
  v_retakes integer;
begin
  select * into v_visit from public.case_visits where id = p_visit_id for update;

  if not found then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;

  select * into v_case from public.cases where id = v_visit.case_id;

  v_was_locked := v_visit.images_locked_at is not null;

  select count(*)::int into v_retakes
  from public.clinical_images
  where visit_id = p_visit_id and review_status = 'REPHOTO_REQUESTED';

  update public.case_visits
  set images_locked_at = now()
  where id = p_visit_id
  returning * into v_visit;

  -- The retakes have been carried out; the phase is the administrator's again.
  update public.clinical_images
  set review_status = 'PENDING',
      review_note = null,
      reviewed_by = null,
      reviewed_at = null
  where visit_id = p_visit_id and review_status = 'REPHOTO_REQUESTED';

  perform public.consume_edit_grant(p_grant_id, p_actor);

  select display_name into v_actor_name from public.profiles where id = p_actor;

  v_phase := case
    when v_visit.visit_type = 'BEFORE' then 'Before'
    when v_visit.visit_type = 'AFTER' then 'After'
    else 'Follow-up (' || v_visit.display_label || ')'
  end;

  perform public.notify_admins(
    case
      when v_retakes > 0 then 'VISIT_IMAGES_RETAKEN'
      when v_was_locked then 'VISIT_IMAGES_UPDATED'
      else 'VISIT_IMAGES_SUBMITTED'
    end,
    v_phase || ' images '
      || (case
            when v_retakes > 0 then 'retaken'
            when v_was_locked then 'updated'
            else 'submitted'
          end)
      || ' — ' || v_case.case_number,
    coalesce(v_actor_name, 'Someone')
      || (case
            when v_retakes > 0
              then ' retook ' || v_retakes || ' view'
                   || (case when v_retakes = 1 then '' else 's' end)
                   || ' and sent the phase back for review.'
            else ' saved this phase.'
          end),
    v_visit.case_id,
    p_visit_id,
    null,
    p_actor
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor,
    case when v_was_locked then 'VISIT_IMAGES_UPDATED' else 'VISIT_IMAGES_SUBMITTED' end,
    'case_visit',
    p_visit_id,
    v_visit.case_id,
    jsonb_build_object(
      'visit_type', v_visit.visit_type,
      'phase', v_phase,
      'retakes_cleared', v_retakes
    )
  );

  return v_visit;
end;
$$;

revoke all on function public.submit_visit_images(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.submit_visit_images(uuid, uuid, uuid) to service_role;
