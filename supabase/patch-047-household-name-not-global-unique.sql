-- Household names are user-facing labels and must not be globally unique.
-- Many users will naturally have a default household named "Hjemme".
-- This fixes duplicate key errors when a new user logs in without an existing household.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'households_name_unique'
      and conrelid = 'public.households'::regclass
  ) then
    alter table public.households
      drop constraint households_name_unique;
  end if;
end $$;

drop index if exists public.households_name_unique;

-- Optional safety: keep household names non-empty when present.
-- Do not add uniqueness; duplicates like "Hjemme" are expected.
