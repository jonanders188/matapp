-- Hardening for household invitation and auth flow.
-- Safe to run more than once in most projects. If the unique constraint already exists
-- with another name, this may report a duplicate constraint; that is OK to ignore.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'household_members_household_user_unique'
      and conrelid = 'public.household_members'::regclass
  ) then
    alter table public.household_members
      add constraint household_members_household_user_unique
      unique (household_id, user_id);
  end if;
end $$;

create unique index if not exists household_invitations_token_key
  on public.household_invitations (token);

create index if not exists household_invitations_pending_household_idx
  on public.household_invitations (household_id, status, expires_at desc);

create index if not exists household_invitations_email_status_idx
  on public.household_invitations (lower(email), status, expires_at desc);
