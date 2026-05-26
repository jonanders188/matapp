-- Close pending household invitations where the invited email is already an active member.
-- This cleans up stale rows caused by earlier invitation/acceptance bugs.

alter table public.household_invitations
  add column if not exists accepted_at timestamptz;

alter table public.household_invitations
  add column if not exists updated_at timestamptz not null default now();

update public.household_invitations hi
set
  status = 'accepted',
  accepted_at = coalesce(hi.accepted_at, now()),
  updated_at = now()
from public.household_members hm
join auth.users u on u.id = hm.user_id
where hi.household_id = hm.household_id
  and lower(trim(hi.email)) = lower(trim(u.email))
  and hi.status = 'pending';
