-- AURA Clinical Data Library
-- 0027: close unauthenticated execute access on privileged functions.
--
-- Found by the RLS deny suite (`pnpm test:rls`), which called each
-- `security definer` function with the anonymous key and nil-UUID arguments. A
-- function that is properly locked down answers `42501 permission denied for
-- function` *before* it runs. Several answered `P0002 ... not found` instead,
-- which means they ran — with no session, as an attacker-chosen `p_actor`, and
-- with the owner's privileges.
--
-- Confirmed reachable by `anon` before this migration:
--
--   create_edit_request       raised the case, then would have written one
--   decide_edit_request       the approval boundary itself
--   grant_edit_access         grants any user edit access to any case
--   consume_edit_grant        returned successfully
--   submit_visit_images       locks a visit's image set
--   remove_current_image      empties a clinical image slot
--   finalize_avatar_upload    repoints a profile's avatar
--   upsert_master_value       reached the INSERT, failed only on the actor FK
--   set_master_value_active   enables/disables master data
--   notify_admins             reached the INSERT into notifications
--   set_case_access           ran, and was stopped only by its own inner check
--   next_case_number          ran, stopped only by the sequence grant
--
-- The cause is Supabase's default privileges, which grant EXECUTE on new
-- functions in `public` to `anon` and `authenticated`. The original migrations
-- said `revoke all ... from public`, and a grant made directly to a role is not
-- removed by revoking from PUBLIC — so the intended lockdown never took effect
-- for these. `finalize_image_upload`, `create_case` and `mark_image_unavailable`
-- were already sealed; they are listed anyway so this file states the whole
-- policy in one place and stays correct if it is ever re-run.
--
-- Safe by construction: every one of these is invoked from server code through
-- the service-role client (`createSupabaseAdminClient`), which is unaffected by
-- a revoke on `anon`/`authenticated`. The one function a user's own session
-- does call — `case_completion`, a read helper — is deliberately not touched.
--
-- Policy helper functions (`is_admin`, `has_role`, `case_is_visible`, …) are
-- also left alone: they are evaluated inside RLS policies as the querying role,
-- so `authenticated` must keep EXECUTE on them.

do $$
declare
  sig text;
begin
  foreach sig in array array[
    -- Case lifecycle
    'public.create_case(uuid, uuid, date, text, uuid[], uuid)',
    'public.set_case_access(uuid, uuid[], uuid)',
    'public.next_case_number()',
    'public.format_case_number(bigint)',

    -- Edit approval workflow
    'public.create_edit_request(uuid, text, uuid, text, uuid)',
    'public.decide_edit_request(uuid, boolean, text, integer, uuid)',
    'public.grant_edit_access(uuid, text, uuid, uuid, text, integer, uuid)',
    'public.consume_edit_grant(uuid, uuid)',

    -- Clinical images
    'public.finalize_image_upload(uuid, bigint, text, uuid)',
    'public.mark_image_unavailable(uuid, uuid, text, uuid)',
    'public.remove_current_image(uuid, uuid)',
    'public.submit_visit_images(uuid, uuid, uuid)',

    -- Profile photos
    'public.finalize_avatar_upload(uuid, uuid)',

    -- Master data
    'public.upsert_master_value(text, text, uuid)',
    'public.set_master_value_active(text, uuid, boolean, uuid)',

    -- Notifications
    'public.notify_admins(text, text, text, uuid, uuid, uuid, uuid)'
  ]
  loop
    -- `to regprocedure` returns null rather than erroring on an unknown
    -- signature, so a rename upstream makes this a no-op instead of a failed
    -- migration. The deny suite is what catches that case.
    if to_regprocedure(sig) is not null then
      execute format('revoke all on function %s from public, anon, authenticated;', sig);
      execute format('grant execute on function %s to service_role;', sig);
    else
      raise warning 'skipping unknown function signature: %', sig;
    end if;
  end loop;
end;
$$;

-- Stop the same hole reopening for functions added later. Supabase's own
-- defaults grant EXECUTE on new `public` functions to `anon` and
-- `authenticated`; this narrows that for functions created by `postgres` from
-- here on. Anything that genuinely needs to be callable from a user's session
-- must now be granted explicitly, which is the right way round.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
