-- Administrator access is always global; keep the stored profile value aligned
-- with the enforced policy and the Users & Access screen.
update public.profiles p
set case_visibility_scope = 'ALL'
from public.roles r
where r.id = p.role_id
  and r.code = 'ADMIN'
  and p.case_visibility_scope is distinct from 'ALL';
