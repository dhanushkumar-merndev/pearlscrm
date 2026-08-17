-- AURA Clinical Data Library
-- 0008: derived read models for the cases list/dashboard.
--
-- security_invoker = true so every view is filtered by the caller's own RLS
-- policies rather than the view owner's.

-- Current consent = the most recently recorded row. No row => NOT_RECORDED.
create or replace view public.case_current_consent
with (security_invoker = true)
as
select distinct on (c.case_id)
  c.case_id,
  c.id as consent_id,
  c.image_use_consent,
  c.notes,
  c.recorded_by,
  c.recorded_at
from public.case_consents c
order by c.case_id, c.recorded_at desc, c.id desc;

-- Per-visit image slot rollup.
create or replace view public.visit_image_summary
with (security_invoker = true)
as
select
  v.id as visit_id,
  v.case_id,
  count(*) filter (where i.availability_status = 'UPLOADED') as uploaded_count,
  count(*) filter (where i.availability_status = 'NOT_AVAILABLE') as not_available_count,
  (select count(*) from public.image_view_types t where t.is_standard and t.is_active)
    as standard_view_count
from public.case_visits v
left join public.clinical_images i on i.visit_id = v.id
group by v.id, v.case_id;

-- One row per case with everything the list/dashboard needs. Keeps the cases
-- table free of N+1 follow-up queries.
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
) bef on true;

-- ---------------------------------------------------------------------------
-- Completion. Returns the individual checklist facts; the percentage and the
-- "is complete" decision are derived from these, never from a threshold alone.
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
    select count(*)::int as resolved
    from public.clinical_images i
    join before_visit bv on bv.id = i.visit_id
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

grant select on public.case_list_view, public.case_current_consent, public.visit_image_summary
  to authenticated, service_role;
