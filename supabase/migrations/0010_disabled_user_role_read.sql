-- Pearls Aesthetic Clinical Library
-- 0010: let a disabled user read the role attached to their own profile.
--
-- Why this exists
-- ---------------
-- `profiles_select` (0007) already lets any authenticated user read their own
-- profile row, disabled or not. `roles_select`, however, was gated purely on
-- `is_active_user()`. `getSessionUser()` reads the profile with an embedded
-- `roles(code)` join, so for a disabled account the join came back NULL, the
-- helper treated the session as anonymous, and the caller got
-- 401 UNAUTHENTICATED instead of the intended
-- 403 "This account has been disabled."
--
-- The practical effect was that `requireUser()`'s disabled branch and the
-- "Access disabled" screen in the app shell were unreachable. Access was still
-- correctly denied — it failed closed — but with the wrong signal, which sent a
-- disabled clinician back to the sign-in page in a loop with no explanation.
--
-- A user's own role code is not privileged information: they can already read
-- their own profile row, which carries `role_id`. This widens the policy by
-- exactly that one row and nothing else.

drop policy if exists roles_select on public.roles;

create policy roles_select on public.roles
  for select to authenticated
  using (
    public.is_active_user()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role_id = roles.id
    )
  );

