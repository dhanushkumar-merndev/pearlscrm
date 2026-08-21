-- AURA Clinical Data Library
-- 0024: move the tag filter into SQL.
--
-- The tag filter used to run in two steps: fetch every case id carrying the tag
-- into the application, then send them back as a PostgREST `in.(...)` list. That
-- has two failure modes, and neither is a slow query:
--
--   * it was capped at 5000 ids and truncated silently, so a popular tag
--     returned a confidently wrong page with nothing on screen to say so;
--   * the ids travel in the URL. At 36 bytes each, ~300 tagged cases already
--     exceeds a default 8KB request line and the query starts failing outright.
--
-- Appending the tag ids to the read model lets the filter be expressed as a
-- single containment test (`tag_ids @> '{...}'`), which is correct at any size
-- and keeps the request small.
--
-- `create or replace` is used rather than drop/create: appending a column at the
-- end is permitted, and it leaves `case_admin_list_view` — which selects
-- `clv.*` and expanded that list when it was created — intact.

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
    as standard_view_count,
  -- Appended last so the column order above is unchanged.
  coalesce(tg.tag_ids, '{}'::uuid[]) as tag_ids
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
) aft on true
left join lateral (
  select array_agg(ct.tag_id) as tag_ids
  from public.case_tags ct
  where ct.case_id = c.id
) tg on true;

grant select on public.case_list_view to authenticated, service_role;

-- Serves the per-case lookup the lateral above performs.
create index if not exists case_tags_case_id_idx on public.case_tags (case_id);
