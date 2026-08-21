-- Pearls Aesthetic Clinical Library
-- 0013: three-role model (Admin / Doctor / Viewer) with per-case visibility.
--
-- Replaces the four-role model (ADMIN, SURGEON, STAFF, VIEWER) with three:
--
--   ADMIN  — everything, always, on every case. Manages users, audit,
--            master data, review, and can revert any mistake (archive/
--            restore, complete/reopen) regardless of which Doctor owns the
--            case.
--   DOCTOR — full clinical work: create cases, upload images, follow-ups,
--            notes, consent. Does NOT write the expert review — that is
--            Admin-only (Dr. Praveen's final assessment is recorded by the
--            ADMIN account, distinct from the Doctor who created the case).
--            Sees only the cases they created by default
--            (`case_visibility_scope = 'OWN'`); an admin can widen a
--            specific doctor to see every case (`'ALL'`) from the Users page.
--   VIEWER — read-only. Either sees every case (`'ALL'`, the previous
--            behavior and still the default) or only cases an admin
--            explicitly grants them via `case_viewer_access` (`'SELECTED'`).
--
-- This was a clean cutover, not a data migration: at the time of writing,
-- `SURGEON` and `STAFF` had zero users between them (verified against the
-- live database before writing this migration).
--
-- Admin's override is deliberate and load-bearing: every visibility and
-- write check below short-circuits on `is_admin()` first, so a case closed
-- or archived by mistake can always be reverted by an administrator no
-- matter who created it.

-- ---------------------------------------------------------------------------
-- 1. Role rename + removal. Safe because no profile references SURGEON or
--    STAFF (checked before this migration was written).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id where r.code in ('SURGEON', 'STAFF')) then
    raise exception 'migration 0013 assumes no profile holds SURGEON or STAFF; reassign those users first';
  end if;
end;
$$;

-- Widen the check constraint from migration 0001 before the rename below can
-- write 'DOCTOR' into the still-old-shaped column, then narrow it back down
-- to exactly the three codes this migration leaves in place.
alter table public.roles drop constraint if exists roles_code_allowed;

alter table public.roles
  add constraint roles_code_allowed check (code in ('ADMIN', 'SURGEON', 'STAFF', 'DOCTOR', 'VIEWER'));

update public.roles set code = 'DOCTOR', name = 'Doctor' where code = 'SURGEON';

delete from public.roles where code = 'STAFF';

alter table public.roles drop constraint if exists roles_code_allowed;

alter table public.roles
  add constraint roles_code_allowed check (code in ('ADMIN', 'DOCTOR', 'VIEWER'));

-- ---------------------------------------------------------------------------
-- 2. Per-case visibility scope.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists case_visibility_scope text not null default 'ALL';

alter table public.profiles
  drop constraint if exists profiles_case_visibility_scope_allowed;

alter table public.profiles
  add constraint profiles_case_visibility_scope_allowed
  check (case_visibility_scope in ('ALL', 'OWN', 'SELECTED'));

-- Doctors default to seeing only their own cases; the application sets this
-- explicitly at account creation (src/server/actions/users.ts) rather than
-- relying on a role-conditional column default, which Postgres can't express
-- declaratively. This statement only backfills any row that predates the
-- column (there are none in practice, per the check above, but it keeps the
-- migration correct if run against a database that already has doctors).
update public.profiles p
set case_visibility_scope = 'OWN'
from public.roles r
where r.id = p.role_id and r.code = 'DOCTOR' and p.case_visibility_scope = 'ALL';

-- ---------------------------------------------------------------------------
-- 3. case_viewer_access — explicit per-viewer case grants, used only when a
--    VIEWER's scope is 'SELECTED'. Server-only, same pattern as
--    image_upload_sessions: no policy for `authenticated`, so it is managed
--    exclusively through the admin client behind requirePermission("user:manage")
--    and read only through the SECURITY DEFINER case_is_visible() below.
-- ---------------------------------------------------------------------------
create table if not exists public.case_viewer_access (
  case_id uuid not null references public.cases (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (case_id, user_id)
);

create index if not exists case_viewer_access_user_idx on public.case_viewer_access (user_id);

alter table public.case_viewer_access enable row level security;

alter table public.case_viewer_access force row level security;

-- ---------------------------------------------------------------------------
-- 4. case_is_visible() — the single source of truth for "can the current
--    user see this case", replacing the old blanket is_active_user() read
--    policy on every clinical table. SECURITY DEFINER so it can read
--    profiles/cases/case_viewer_access regardless of the caller's own RLS
--    visibility into those tables (same bypass pattern already used by
--    is_active_user() and case_is_writable() above it).
-- ---------------------------------------------------------------------------
create or replace function public.case_is_visible(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_active_user()
    and (
      public.is_admin()
      or exists (
        select 1
        from public.profiles p
        join public.roles r on r.id = p.role_id
        where p.id = auth.uid()
          and (
            (
              r.code = 'DOCTOR'
              and (
                p.case_visibility_scope = 'ALL'
                or exists (
                  select 1 from public.cases c
                  where c.id = p_case_id and c.created_by = auth.uid()
                )
              )
            )
            or (
              r.code = 'VIEWER'
              and (
                p.case_visibility_scope = 'ALL'
                or exists (
                  select 1 from public.case_viewer_access cva
                  where cva.case_id = p_case_id and cva.user_id = auth.uid()
                )
              )
            )
          )
      )
    );
$$;

revoke all on function public.case_is_visible(uuid) from public;

grant execute on function public.case_is_visible(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Role helpers: STAFF removed, SURGEON renamed to DOCTOR, and Doctor now
--    manages cases (STAFF's old capability) since Doctor does all clinical
--    work under the new model.
-- ---------------------------------------------------------------------------
create or replace function public.can_write_clinical()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_code() in ('ADMIN', 'DOCTOR');
$$;

create or replace function public.can_manage_cases()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_code() in ('ADMIN', 'DOCTOR');
$$;

-- ---------------------------------------------------------------------------
-- 6. Ownership-aware case write check. A doctor may only write to a case
--    they created; admin may write to any case (including archived ones —
--    unchanged from case_is_writable, which this wraps).
-- ---------------------------------------------------------------------------
create or replace function public.case_is_owned_or_admin(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_admin()
    or exists (
      select 1 from public.cases c
      where c.id = p_case_id and c.created_by = auth.uid()
    );
$$;

revoke all on function public.case_is_owned_or_admin(uuid) from public;

grant execute on function public.case_is_owned_or_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Replace every blanket is_active_user() SELECT policy on clinical tables
--    with case_is_visible(). Write (insert/update/delete) policies gain the
--    ownership check via case_is_owned_or_admin() so a Doctor cannot write
--    into a colleague's case even though can_manage_cases()/can_write_clinical()
--    both now return true for any Doctor.
-- ---------------------------------------------------------------------------

-- cases ------------------------------------------------------------------
drop policy if exists cases_select on public.cases;

create policy cases_select on public.cases
  for select to authenticated
  using (public.case_is_visible(id));

drop policy if exists cases_update on public.cases;

create policy cases_update on public.cases
  for update to authenticated
  using (
    public.can_manage_cases()
    and public.case_is_owned_or_admin(id)
    and (archived_at is null or public.is_admin())
  )
  with check (public.can_manage_cases() and public.case_is_owned_or_admin(id));

-- cases_insert is unchanged: can_manage_cases() alone is correct there,
-- since ownership cannot be evaluated before the row exists — the inserted
-- row's created_by is set by the application to auth.uid() regardless.

-- case_tags ----------------------------------------------------------------
drop policy if exists case_tags_select on public.case_tags;

create policy case_tags_select on public.case_tags
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists case_tags_insert on public.case_tags;

create policy case_tags_insert on public.case_tags
  for insert to authenticated
  with check (
    public.can_manage_cases() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  );

drop policy if exists case_tags_delete on public.case_tags;

create policy case_tags_delete on public.case_tags
  for delete to authenticated
  using (
    public.can_manage_cases() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  );

-- case_visits ----------------------------------------------------------------
drop policy if exists case_visits_select on public.case_visits;

create policy case_visits_select on public.case_visits
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists case_visits_insert on public.case_visits;

create policy case_visits_insert on public.case_visits
  for insert to authenticated
  with check (
    public.can_manage_cases() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  );

drop policy if exists case_visits_update on public.case_visits;

create policy case_visits_update on public.case_visits
  for update to authenticated
  using (
    public.can_write_clinical() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  )
  with check (
    public.can_write_clinical() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  );

-- case_visits_delete unchanged: already is_admin()-only.

-- clinical_images --------------------------------------------------------
drop policy if exists clinical_images_select on public.clinical_images;

create policy clinical_images_select on public.clinical_images
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists clinical_images_insert on public.clinical_images;

create policy clinical_images_insert on public.clinical_images
  for insert to authenticated
  with check (
    public.can_manage_cases() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  );

drop policy if exists clinical_images_update on public.clinical_images;

create policy clinical_images_update on public.clinical_images
  for update to authenticated
  using (
    public.can_manage_cases() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  )
  with check (
    public.can_manage_cases() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  );

-- clinical_image_versions — no case_id column; visible exactly when the
-- clinical_images row (slot) it belongs to is visible.
drop policy if exists clinical_image_versions_select on public.clinical_image_versions;

create policy clinical_image_versions_select on public.clinical_image_versions
  for select to authenticated
  using (
    exists (
      select 1 from public.clinical_images ci
      where ci.id = clinical_image_versions.clinical_image_id
        and public.case_is_visible(ci.case_id)
    )
  );

-- case_notes -----------------------------------------------------------------
drop policy if exists case_notes_select on public.case_notes;

create policy case_notes_select on public.case_notes
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists case_notes_insert on public.case_notes;

create policy case_notes_insert on public.case_notes
  for insert to authenticated
  with check (
    public.can_write_clinical() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  );

drop policy if exists case_notes_update on public.case_notes;

create policy case_notes_update on public.case_notes
  for update to authenticated
  using (
    public.can_write_clinical() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  )
  with check (
    public.can_write_clinical() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  );

drop policy if exists case_changes_select on public.case_changes_performed;

create policy case_changes_select on public.case_changes_performed
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists case_changes_write on public.case_changes_performed;

create policy case_changes_write on public.case_changes_performed
  for all to authenticated
  using (
    public.can_write_clinical() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  )
  with check (
    public.can_write_clinical() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  );

-- consent --------------------------------------------------------------------
drop policy if exists case_consents_select on public.case_consents;

create policy case_consents_select on public.case_consents
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists case_consents_insert on public.case_consents;

create policy case_consents_insert on public.case_consents
  for insert to authenticated
  with check (
    public.can_manage_cases() and public.case_is_owned_or_admin(case_id) and public.case_is_writable(case_id)
  );

-- expert review — ADMIN only from this migration on. A Doctor can create and
-- run the whole case but does not write Dr. Praveen's final assessment.
drop policy if exists case_reviews_select on public.case_reviews;

create policy case_reviews_select on public.case_reviews
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists case_reviews_update on public.case_reviews;

create policy case_reviews_update on public.case_reviews
  for update to authenticated
  using (public.is_admin() and public.case_is_writable(case_id))
  with check (public.is_admin() and public.case_is_writable(case_id));

drop policy if exists case_review_revisions_select on public.case_review_revisions;

create policy case_review_revisions_select on public.case_review_revisions
  for select to authenticated
  using (public.case_is_visible(case_id));

drop policy if exists case_review_revisions_insert on public.case_review_revisions;

create policy case_review_revisions_insert on public.case_review_revisions
  for insert to authenticated
  with check (public.is_admin());

-- master data — Doctor replaces Surgeon/Staff as the non-admin creator.
drop policy if exists procedures_insert on public.procedures;

create policy procedures_insert on public.procedures
  for insert to authenticated
  with check (public.can_write_clinical());

drop policy if exists procedure_types_insert on public.procedure_types;

create policy procedure_types_insert on public.procedure_types
  for insert to authenticated
  with check (public.can_write_clinical());

drop policy if exists complication_types_insert on public.complication_types;

create policy complication_types_insert on public.complication_types
  for insert to authenticated
  with check (public.can_write_clinical());

drop policy if exists clinical_tags_insert on public.clinical_tags;

create policy clinical_tags_insert on public.clinical_tags
  for insert to authenticated
  with check (public.can_write_clinical());

drop policy if exists followup_label_presets_insert on public.followup_label_presets;

create policy followup_label_presets_insert on public.followup_label_presets
  for insert to authenticated
  with check (public.can_write_clinical());

-- ---------------------------------------------------------------------------
-- 8. Baseline grants for the new table (RLS still narrows this to nothing
--    for `authenticated`, matching image_upload_sessions).
-- ---------------------------------------------------------------------------
revoke all on public.case_viewer_access from anon;

revoke all on public.case_viewer_access from authenticated;

grant all on public.case_viewer_access to service_role;

