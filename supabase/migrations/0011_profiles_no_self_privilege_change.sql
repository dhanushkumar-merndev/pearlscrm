-- Pearls Aesthetic Clinical Library
-- 0011: stop a user from editing their own role or active flag.
--
-- The hole this closes
-- --------------------
-- `profiles_update_self` (0007) reads:
--
--     using       (id = auth.uid() and public.is_active_user())
--     with check  (id = auth.uid())
--
-- Both clauses only constrain *which row* is touched, never *which columns*.
-- Any signed-in user could therefore PATCH their own profile row straight at
-- PostgREST with the public anon key and set `role_id` to ADMIN:
--
--     PATCH /rest/v1/profiles?id=eq.<self>   {"role_id": "<admin role id>"}
--     -> 204, role really changed
--
-- Verified against this database with a throwaway VIEWER account: role went
-- VIEWER -> ADMIN. The comment in 0007 already stated the intent — "User
-- administration (role assignment, disabling) is service-role only" — but
-- nothing enforced it, because RLS policies cannot see OLD values and so cannot
-- express "this column must not change".
--
-- Column-level privileges are the mechanism that can. `authenticated` keeps
-- UPDATE on `display_name` only, which is all `profiles_update_self` was ever
-- meant to allow. `service_role` is unaffected — it holds its own grants and
-- bypasses RLS — and every legitimate profile write in the app already goes
-- through the admin client in `src/server/actions/users.ts`.
--
-- Re-enabling a disabled account was already blocked, because the policy's
-- USING clause requires `is_active_user()`; only the role change got through.

revoke update on public.profiles from authenticated;

revoke update on public.profiles from anon;

grant update (display_name) on public.profiles to authenticated;

-- Verify after applying (expect: role unchanged, and a 401/403 rather than 204):
--
--   PATCH /rest/v1/profiles?id=eq.<own id>   {"role_id": "<admin role id>"}
--
-- `scripts/api-smoke.mjs` section 11 asserts exactly this.;

