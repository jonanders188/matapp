-- Matmakt patch 032
-- Tilgangsmodell for husholdninger.
-- Husholdningsnavn skal ikke være unikt. household.id er den reelle identiteten.
-- Barn og medlem behandles likt i appen foreløpig.

create unique index if not exists household_members_household_user_unique
  on public.household_members (household_id, user_id);

-- Sørg for at kjente roller er avgrenset. Eksisterende "child" beholdes for bakoverkompatibilitet,
-- men appen viser og behandler child som member.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'household_members_role_check'
      and conrelid = 'public.household_members'::regclass
  ) then
    alter table public.household_members
      add constraint household_members_role_check
      check (role in ('admin', 'member', 'child'));
  end if;
end $$;
