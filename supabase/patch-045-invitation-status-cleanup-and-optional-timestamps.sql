-- Clean up stale/pending invitations and add optional timestamp columns.
-- Safe to run repeatedly.

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

update public.household_invitations
set updated_at = now()
where updated_at is null;
