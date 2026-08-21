-- Case notes lock on first save. A Doctor must then use the existing
-- administrator approval workflow for each subsequent editing pass.

begin;

alter table public.case_notes
  add column if not exists locked_at timestamptz;

-- Preserve the submitted state of any pre-existing notes with clinical data.
update public.case_notes n
set locked_at = n.updated_at
where n.locked_at is null
  and (
    n.patient_concern is not null
    or n.preop_assessment is not null
    or n.treatment_recommendation is not null
    or n.preop_aesthetic_goal is not null
    or n.surgeon_assessment is not null
    or n.outcome is not null
    or n.complications_present is not null
    or n.revision_required is not null
    or exists (
      select 1 from public.case_changes_performed c where c.case_id = n.case_id
    )
  );

alter table public.case_edit_requests
  drop constraint if exists case_edit_requests_scope_allowed;
alter table public.case_edit_requests
  add constraint case_edit_requests_scope_allowed
    check (scope in ('CASE_INFORMATION', 'CASE_NOTES', 'VISIT_DETAILS', 'VISIT_IMAGES'));

alter table public.case_edit_requests
  drop constraint if exists case_edit_requests_visit_required;
alter table public.case_edit_requests
  add constraint case_edit_requests_visit_required
    check ((scope in ('CASE_INFORMATION', 'CASE_NOTES')) = (visit_id is null));

-- The older approval functions already store and authorize arbitrary valid
-- scopes. Normalize their user-facing notification wording for CASE_NOTES.
create or replace function public.case_notes_notification_wording()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_scope text;
begin
  if new.edit_request_id is null then
    return new;
  end if;

  select r.scope into v_scope
  from public.case_edit_requests r
  where r.id = new.edit_request_id;

  if v_scope = 'CASE_NOTES' then
    new.body := replace(new.body, 'visit images', 'case notes');
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_case_notes_wording on public.notifications;
create trigger notifications_case_notes_wording
  before insert on public.notifications
  for each row execute function public.case_notes_notification_wording();

commit;
