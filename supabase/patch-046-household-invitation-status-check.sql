-- Fix allowed statuses for household invitations.
-- The app uses pending, accepted, cancelled and expired.
-- Existing DB constraint only allowed a smaller set, causing 23514 on "Avbryt".

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'household_invitations_status_check'
      and conrelid = 'public.household_invitations'::regclass
  ) then
    alter table public.household_invitations
      drop constraint household_invitations_status_check;
  end if;
end $$;

alter table public.household_invitations
  add constraint household_invitations_status_check
  check (status in ('pending', 'accepted', 'cancelled', 'expired'));

-- Clean up rows that are still pending although the invited email is already an active member.
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
