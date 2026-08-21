-- Administrator-only case list metadata. Creator identity is intentionally
-- separated from the normal case list so Doctor and Viewer requests never
-- receive a display name for the user who created a case.

create or replace view public.case_admin_list_view
with (security_invoker = true)
as
select
  clv.*,
  p.display_name as creator_name
from public.case_list_view clv
left join public.profiles p on p.id = clv.created_by
where public.is_admin();

grant select on public.case_admin_list_view to authenticated, service_role;
