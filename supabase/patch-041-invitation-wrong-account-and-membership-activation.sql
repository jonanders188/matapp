-- Hardening for invitation acceptance and membership activation.
-- Allows one membership per user per household, but the same user can be member of several households.

update public.household_invitations
set email = lower(trim(email))
where email is not null;

create unique index if not exists household_members_household_id_user_id_key
on public.household_members (household_id, user_id);

create index if not exists household_invitations_token_status_idx
on public.household_invitations (token, status, expires_at desc);

create index if not exists household_members_user_household_idx
on public.household_members (user_id, household_id);
