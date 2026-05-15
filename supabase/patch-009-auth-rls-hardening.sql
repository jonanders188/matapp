-- patch-009-auth-rls-hardening.sql
-- Idempotent hardening for private household app.
-- Run in Supabase SQL Editor after confirming household_members.user_id values exist in auth.users.

begin;

-- 1. Required household/user links
alter table public.household_members alter column household_id set not null;
alter table public.household_members alter column user_id set not null;
alter table public.inventory_items alter column household_id set not null;
alter table public.freezer_items alter column household_id set not null;
alter table public.purchases alter column household_id set not null;
alter table public.recommendations alter column household_id set not null;
alter table public.product_alternatives alter column household_id set not null;
alter table public.purchase_items alter column purchase_id set not null;

-- shopping tables exist in the current database, but these guards keep the migration reusable.
do $$
begin
  if to_regclass('public.shopping_lists') is not null then
    alter table public.shopping_lists alter column household_id set not null;
  end if;

  if to_regclass('public.shopping_list_items') is not null then
    alter table public.shopping_list_items alter column household_id set not null;
    alter table public.shopping_list_items alter column shopping_list_id set not null;
  end if;
end $$;

-- 2. Link household members to Supabase Auth users.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'household_members_user_id_fkey'
  ) then
    alter table public.household_members
      add constraint household_members_user_id_fkey
      foreign key (user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end $$;

-- 3. Role and duplicate protection.
alter table public.household_members alter column role set default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'household_members_role_check'
  ) then
    alter table public.household_members
      add constraint household_members_role_check
      check (role in ('admin', 'member', 'child'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'household_members_household_user_unique'
  ) then
    alter table public.household_members
      add constraint household_members_household_user_unique
      unique (household_id, user_id);
  end if;
end $$;

-- 4. RLS helper functions.
create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
  );
$$;

create or replace function public.is_household_admin(target_household_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
      and hm.role = 'admin'
  );
$$;

-- 5. RLS enabled.
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.products enable row level security;
alter table public.inventory_items enable row level security;
alter table public.freezer_items enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.recommendations enable row level security;
alter table public.product_alternatives enable row level security;
alter table public.price_observations enable row level security;

do $$
begin
  if to_regclass('public.shopping_lists') is not null then
    alter table public.shopping_lists enable row level security;
  end if;

  if to_regclass('public.shopping_list_items') is not null then
    alter table public.shopping_list_items enable row level security;
  end if;
end $$;

-- 6. Policies.
drop policy if exists "Members can read households" on public.households;
create policy "Members can read households"
on public.households for select to authenticated
using (public.is_household_member(id));

drop policy if exists "Admins can update households" on public.households;
create policy "Admins can update households"
on public.households for update to authenticated
using (public.is_household_admin(id))
with check (public.is_household_admin(id));

drop policy if exists "Members can read household members" on public.household_members;
create policy "Members can read household members"
on public.household_members for select to authenticated
using (public.is_household_member(household_id));

drop policy if exists "Admins can insert household members" on public.household_members;
create policy "Admins can insert household members"
on public.household_members for insert to authenticated
with check (public.is_household_admin(household_id));

drop policy if exists "Admins can update household members" on public.household_members;
create policy "Admins can update household members"
on public.household_members for update to authenticated
using (public.is_household_admin(household_id))
with check (public.is_household_admin(household_id));

drop policy if exists "Admins can delete household members" on public.household_members;
create policy "Admins can delete household members"
on public.household_members for delete to authenticated
using (public.is_household_admin(household_id));

drop policy if exists "Members can read products" on public.products;
create policy "Members can read products"
on public.products for select to authenticated
using (household_id is null or public.is_household_member(household_id));

drop policy if exists "Members can insert household products" on public.products;
create policy "Members can insert household products"
on public.products for insert to authenticated
with check (household_id is not null and public.is_household_member(household_id));

drop policy if exists "Members can update household products" on public.products;
create policy "Members can update household products"
on public.products for update to authenticated
using (household_id is not null and public.is_household_member(household_id))
with check (household_id is not null and public.is_household_member(household_id));

drop policy if exists "Members can delete household products" on public.products;
create policy "Members can delete household products"
on public.products for delete to authenticated
using (household_id is not null and public.is_household_member(household_id));

drop policy if exists "Members can manage inventory" on public.inventory_items;
create policy "Members can manage inventory"
on public.inventory_items for all to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "Members can manage freezer items" on public.freezer_items;
create policy "Members can manage freezer items"
on public.freezer_items for all to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "Members can manage purchases" on public.purchases;
create policy "Members can manage purchases"
on public.purchases for all to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "Members can read purchase items" on public.purchase_items;
create policy "Members can read purchase items"
on public.purchase_items for select to authenticated
using (exists (
  select 1 from public.purchases p
  where p.id = purchase_items.purchase_id
    and public.is_household_member(p.household_id)
));

drop policy if exists "Members can insert purchase items" on public.purchase_items;
create policy "Members can insert purchase items"
on public.purchase_items for insert to authenticated
with check (exists (
  select 1 from public.purchases p
  where p.id = purchase_items.purchase_id
    and public.is_household_member(p.household_id)
));

drop policy if exists "Members can update purchase items" on public.purchase_items;
create policy "Members can update purchase items"
on public.purchase_items for update to authenticated
using (exists (
  select 1 from public.purchases p
  where p.id = purchase_items.purchase_id
    and public.is_household_member(p.household_id)
))
with check (exists (
  select 1 from public.purchases p
  where p.id = purchase_items.purchase_id
    and public.is_household_member(p.household_id)
));

drop policy if exists "Members can delete purchase items" on public.purchase_items;
create policy "Members can delete purchase items"
on public.purchase_items for delete to authenticated
using (exists (
  select 1 from public.purchases p
  where p.id = purchase_items.purchase_id
    and public.is_household_member(p.household_id)
));

drop policy if exists "Members can manage recommendations" on public.recommendations;
create policy "Members can manage recommendations"
on public.recommendations for all to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "Members can manage product alternatives" on public.product_alternatives;
create policy "Members can manage product alternatives"
on public.product_alternatives for all to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "Authenticated users can read price observations" on public.price_observations;
create policy "Authenticated users can read price observations"
on public.price_observations for select to authenticated
using (true);

-- Shopping policies guarded by dynamic SQL because older local schemas may not have these tables.
do $$
begin
  if to_regclass('public.shopping_lists') is not null then
    execute 'drop policy if exists "Members can manage shopping lists" on public.shopping_lists';
    execute 'create policy "Members can manage shopping lists" on public.shopping_lists for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id))';
  end if;

  if to_regclass('public.shopping_list_items') is not null then
    execute 'drop policy if exists "Members can manage shopping list items" on public.shopping_list_items';
    execute 'create policy "Members can manage shopping list items" on public.shopping_list_items for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id))';
  end if;
end $$;

commit;
