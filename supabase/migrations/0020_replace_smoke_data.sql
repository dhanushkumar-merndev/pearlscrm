-- One-time cleanup of the API smoke-test dataset requested before production
-- use. Keeps real accounts and immutable historical audit events, removes test
-- cases/master values, resets case numbering, and creates three non-identifying
-- workflow examples for Admin, Doctor, and selected-case Viewer access.

begin;

do $$
declare
  v_admin uuid;
  v_doctor uuid;
  v_viewer uuid;
  v_primary uuid;
  v_revision uuid;
  v_rhinoplasty uuid;
  v_revision_rhinoplasty uuid;
  v_functional_rhinoplasty uuid;
  v_case_doctor public.cases;
  v_case_assigned public.cases;
  v_case_viewer public.cases;
begin
  select p.id into v_admin
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where r.code = 'ADMIN' and p.is_active
  order by case when p.display_name = 'Clinic Admin' then 0 else 1 end, p.created_at
  limit 1;

  select p.id into v_doctor
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where r.code = 'DOCTOR'
    and p.display_name = 'Dhanush Kumar R'
    and p.is_active
  limit 1;

  select p.id into v_viewer
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where r.code = 'VIEWER'
    and p.display_name = 'Testing'
    and p.is_active
  limit 1;

  if v_admin is null or v_doctor is null or v_viewer is null then
    raise exception 'Required Clinic Admin, Dhanush Kumar R Doctor, or Testing Viewer account is missing';
  end if;

  -- Break the current-version cycle, then temporarily allow removal of test
  -- version metadata. Corresponding private Tigris test objects are removed by
  -- the controlled deployment cleanup before this migration is applied.
  update public.clinical_images
  set availability_status = 'MISSING',
      current_version_id = null,
      not_available_reason = null,
      not_available_by = null,
      not_available_at = null;
  delete from public.image_upload_sessions;
  alter table public.clinical_image_versions disable trigger clinical_image_versions_immutable;
  delete from public.clinical_image_versions;
  alter table public.clinical_image_versions enable trigger clinical_image_versions_immutable;

  alter table public.case_consents disable trigger case_consents_no_update;
  delete from public.cases;
  alter table public.case_consents enable trigger case_consents_no_update;

  -- The old environment contains only smoke-test procedure/tag values.
  delete from public.procedures;
  delete from public.clinical_tags;
  update public.procedure_types set usage_count = 0;

  perform setval('public.case_number_seq', 1, false);

  insert into public.procedures (
    normalized_key, display_name, is_active, usage_count, created_by
  ) values
    ('rhinoplasty', 'Rhinoplasty', true, 0, v_admin),
    ('revision rhinoplasty', 'Revision Rhinoplasty', true, 0, v_admin),
    ('functional rhinoplasty', 'Functional Rhinoplasty', true, 0, v_admin)
  on conflict (normalized_key) do update
    set display_name = excluded.display_name,
        is_active = true,
        usage_count = 0;

  select id into v_primary from public.procedure_types where normalized_key = 'primary';
  select id into v_revision from public.procedure_types where normalized_key = 'revision';
  select id into v_rhinoplasty from public.procedures where normalized_key = 'rhinoplasty';
  select id into v_revision_rhinoplasty from public.procedures where normalized_key = 'revision rhinoplasty';
  select id into v_functional_rhinoplasty from public.procedures where normalized_key = 'functional rhinoplasty';

  select * into v_case_doctor from public.create_case(
    v_rhinoplasty, v_primary, date '2026-06-15', 'Routine staged follow-up', array[]::uuid[], v_doctor
  );

  select * into v_case_assigned from public.create_case(
    v_revision_rhinoplasty, v_revision, date '2026-05-02', 'Three-month review planned', array[]::uuid[], v_admin
  );

  select * into v_case_viewer from public.create_case(
    v_functional_rhinoplasty, v_primary, date '2026-07-10', 'Early follow-up planned', array[]::uuid[], v_admin
  );

  update public.profiles
  set case_visibility_scope = 'SELECTED'
  where id in (v_doctor, v_viewer);

  -- Doctor: own case plus one explicitly assigned case.
  -- Viewer: one explicitly selected read-only case.
  insert into public.case_viewer_access (case_id, user_id, granted_by) values
    (v_case_assigned.id, v_doctor, v_admin),
    (v_case_viewer.id, v_viewer, v_admin)
  on conflict (case_id, user_id) do update
    set granted_by = excluded.granted_by,
        granted_at = now();

  insert into public.case_consents (
    case_id, image_use_consent, notes, recorded_by, recorded_at
  ) values
    (v_case_doctor.id, true, 'Example consent recorded for workflow validation.', v_doctor, now()),
    (v_case_assigned.id, true, 'Example consent recorded for workflow validation.', v_admin, now()),
    (v_case_viewer.id, false, 'Example case is not consented for image use.', v_admin, now());

  -- This submitted note demonstrates the approval lock: Dhanush can read it,
  -- but must ask an administrator before the next edit.
  update public.case_notes
  set patient_concern = 'Example concern: nasal profile and breathing balance.',
      preop_assessment = 'Example structured pre-operative assessment.',
      treatment_recommendation = 'Example treatment recommendation for workflow validation.',
      preop_aesthetic_goal = 'Example goal: balanced, natural proportions.',
      dorsum = 'Example dorsal assessment recorded.',
      tip = 'Example tip assessment recorded.',
      surgeon_assessment = 'Example clinician assessment; no patient identity is stored.',
      outcome = 'Example outcome pending follow-up.',
      complications_present = false,
      revision_required = false,
      updated_by = v_doctor,
      locked_at = now(),
      version = 2
  where case_id = v_case_doctor.id;

  insert into public.case_changes_performed (
    case_id, description, sort_order, created_by
  ) values
    (v_case_doctor.id, 'Dorsal refinement', 0, v_doctor),
    (v_case_doctor.id, 'Tip refinement', 1, v_doctor);

  insert into public.case_visits (
    case_id, visit_type, visit_date, display_label, months_after_surgery,
    clinical_observation, details_locked_at, created_by
  ) values
    (v_case_doctor.id, 'FOLLOW_UP', date '2026-07-15', '1 Month', 1,
      'Example follow-up observation: routine healing review.', now(), v_doctor),
    (v_case_assigned.id, 'FOLLOW_UP', date '2026-08-02', '3 Months', 3,
      'Example follow-up observation: scheduled clinical review.', now(), v_admin);

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    v_admin,
    'SMOKE_DATA_REPLACED',
    'system',
    null,
    jsonb_build_object(
      'new_case_count', 3,
      'doctor_owned_case', v_case_doctor.id,
      'doctor_assigned_case', v_case_assigned.id,
      'viewer_assigned_case', v_case_viewer.id
    )
  );
end;
$$;

commit;
