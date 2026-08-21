-- AURA Clinical Data Library
-- 0016: real-time change delivery.
--
-- The clinic runs one administrator alongside roughly twenty clinicians, and the
-- administrator is the one who needs to see submissions and requests the moment
-- they happen. Polling for that costs a request per user per interval, all day,
-- for changes that mostly are not there.
--
-- Supabase Realtime carries the change instead: one WebSocket per open tab,
-- messages only when a row actually changes. It is part of the existing Supabase
-- stack — no cache, queue or broker is introduced, and none is warranted at this
-- size.
--
-- Postgres Changes applies the subscriber's own RLS policies before delivering a
-- row, so the same policies that gate the REST reads gate these. A user is sent
-- their own notifications; an administrator additionally sees the request and
-- clinical rows their policies already allow.

do $$
declare
  t text;
begin
  foreach t in array array[
    'notifications',
    'case_edit_requests',
    'cases',
    'case_visits',
    'clinical_images',
    'case_reviews'
  ]
  loop
    -- `add table` errors if the table is already published, so check first.
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
    end if;
  end loop;
end;
$$;

-- DEFAULT replica identity publishes the primary key on UPDATE, which is all the
-- client needs: every subscriber reacts by re-reading through its own authorized
-- query rather than trusting the payload. FULL would copy clinical column values
-- into the realtime stream for no benefit.
