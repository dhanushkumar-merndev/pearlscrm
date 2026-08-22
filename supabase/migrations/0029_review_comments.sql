-- AURA Clinical Data Library
-- 0029: discussion on the expert review.
--
-- The final assessment is the administrator's, and only they can change it.
-- That is correct, but it left the operating surgeon with no way to say "the
-- dorsal reduction is described as 2 mm, it was closer to 4" — the disagreement
-- either went unrecorded or travelled by some channel the case knows nothing
-- about.
--
-- A thread against the review fixes that without weakening the boundary: the
-- assessment stays single-authored, and the discussion around it is recorded
-- beside it, attributed and timestamped.
--
-- Append-only by design. A clinical disagreement that can be quietly deleted is
-- worth less than one that cannot, so there is no update or delete policy and
-- the table carries a trigger that refuses both regardless of role.

create table if not exists public.case_review_comments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  case_review_id uuid not null references public.case_reviews (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint case_review_comments_body_present
    check (btrim(body) <> '' and length(body) <= 4000)
);

create index if not exists case_review_comments_case_idx
  on public.case_review_comments (case_id, created_at);
create index if not exists case_review_comments_review_idx
  on public.case_review_comments (case_review_id, created_at);

-- Same guarantee `audit_logs` has, and for the same reason.
create or replace function public.case_review_comments_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'review comments cannot be changed or deleted';
end;
$$;

drop trigger if exists case_review_comments_no_update on public.case_review_comments;
create trigger case_review_comments_no_update
  before update on public.case_review_comments
  for each row execute function public.case_review_comments_block_mutation();

drop trigger if exists case_review_comments_no_delete on public.case_review_comments;
create trigger case_review_comments_no_delete
  before delete on public.case_review_comments
  for each row execute function public.case_review_comments_block_mutation();

alter table public.case_review_comments enable row level security;
alter table public.case_review_comments force row level security;

-- Readable by anyone who can see the case: the thread is part of the case
-- record, and a reply nobody can read helps no one.
drop policy if exists case_review_comments_select on public.case_review_comments;
create policy case_review_comments_select on public.case_review_comments
  for select to authenticated
  using (public.case_is_visible(case_id));

-- Writing goes through the server, which checks the permission and sends the
-- notification. No insert policy for `authenticated`.

-- ---------------------------------------------------------------------------
-- Post a comment and tell the other side.
--
-- Who hears about it depends on who spoke: a doctor questioning the assessment
-- needs to reach the administrator who wrote it; the administrator replying
-- needs to reach whoever raised the point.
-- ---------------------------------------------------------------------------
create or replace function public.add_review_comment(
  p_case_id uuid,
  p_body text,
  p_actor uuid
)
returns public.case_review_comments
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.cases;
  v_review public.case_reviews;
  v_comment public.case_review_comments;
  v_actor_role text;
  v_actor_name text;
  v_recipient uuid;
begin
  select r.code, p.display_name into v_actor_role, v_actor_name
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = p_actor and p.is_active;

  if v_actor_role is null then
    raise exception 'account is not active' using errcode = '42501';
  end if;

  -- A read-only account reads the discussion; it does not join it.
  if v_actor_role not in ('ADMIN', 'DOCTOR') then
    raise exception 'this account cannot comment on a review' using errcode = '42501';
  end if;

  select * into v_case from public.cases where id = p_case_id;
  if not found then
    raise exception 'case not found' using errcode = 'P0002';
  end if;

  if v_case.archived_at is not null then
    raise exception 'this case is archived' using errcode = '22023';
  end if;

  select * into v_review from public.case_reviews where case_id = p_case_id;
  if not found then
    raise exception 'review not found' using errcode = 'P0002';
  end if;

  insert into public.case_review_comments (case_id, case_review_id, author_id, body)
  values (p_case_id, v_review.id, p_actor, btrim(p_body))
  returning * into v_comment;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, case_id, metadata)
  values (
    p_actor,
    'REVIEW_COMMENT_ADDED',
    'case_review',
    v_review.id,
    p_case_id,
    -- The wording itself is clinical narrative and stays out of the log.
    jsonb_build_object('comment_id', v_comment.id, 'author_role', v_actor_role)
  );

  if v_actor_role = 'DOCTOR' then
    perform public.notify_admins(
      'REVIEW_COMMENT_ADDED',
      'Comment on the expert review — ' || v_case.case_number,
      coalesce(v_actor_name, 'A doctor') || ' replied to the final assessment.',
      p_case_id,
      null,
      null,
      p_actor
    );
  else
    -- Back to everyone already in the thread, the reviewer aside.
    for v_recipient in
      select distinct author_id from public.case_review_comments
      where case_id = p_case_id and author_id is distinct from p_actor
    loop
      perform public.notify_user(
        v_recipient,
        'REVIEW_COMMENT_ADDED',
        'Reply on the expert review — ' || v_case.case_number,
        coalesce(v_actor_name, 'An administrator') || ' replied to your comment.',
        p_case_id,
        null,
        p_actor
      );
    end loop;
  end if;

  return v_comment;
end;
$$;

revoke all on function public.add_review_comment(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.add_review_comment(uuid, text, uuid) to service_role;

grant select on public.case_review_comments to authenticated, service_role;
