-- Store preferences per household.
-- Used to hide stores from price comparisons and choose which store wins when prices are equal.

create table if not exists public.household_store_preferences (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references public.households(id) on delete cascade,
  store_key text not null,
  store_name text not null,
  priority integer not null default 100,
  is_enabled boolean not null default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint household_store_preferences_priority_check check (priority between 1 and 999),
  constraint household_store_preferences_unique unique (household_id, store_key)
);

create index if not exists household_store_preferences_household_idx
on public.household_store_preferences (household_id, is_enabled, priority, store_name);

alter table public.household_store_preferences enable row level security;

drop policy if exists "Members can read store preferences" on public.household_store_preferences;
create policy "Members can read store preferences"
on public.household_store_preferences
for select
to authenticated
using (
  public.is_household_member(household_id)
);

drop policy if exists "Admins can insert store preferences" on public.household_store_preferences;
create policy "Admins can insert store preferences"
on public.household_store_preferences
for insert
to authenticated
with check (
  public.is_household_admin(household_id)
);

drop policy if exists "Admins can update store preferences" on public.household_store_preferences;
create policy "Admins can update store preferences"
on public.household_store_preferences
for update
to authenticated
using (
  public.is_household_admin(household_id)
)
with check (
  public.is_household_admin(household_id)
);

drop policy if exists "Admins can delete store preferences" on public.household_store_preferences;
create policy "Admins can delete store preferences"
on public.household_store_preferences
for delete
to authenticated
using (
  public.is_household_admin(household_id)
);
