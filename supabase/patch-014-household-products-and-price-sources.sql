-- Patch 014: Split household-specific product settings from product data,
-- and add source/scope metadata for price observations.
--
-- This patch is intentionally backwards compatible:
-- - It does not remove or rename any existing product columns.
-- - Existing app code can keep using products.household_id / products.is_basis.
-- - New code can start reading household-specific settings from household_products.
--
-- Safe to run multiple times.

begin;

create table if not exists public.household_products (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references public.households(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,

  is_basis boolean not null default false,
  desired_stock numeric default 0,
  target_price numeric,
  target_price_unit text default 'unit',
  preferred_store text,
  is_freezable boolean default false,
  notes text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (household_id, product_id)
);

create index if not exists household_products_household_idx
  on public.household_products (household_id, is_basis, created_at desc);

create index if not exists household_products_product_idx
  on public.household_products (product_id);

-- Backfill current household-specific product settings from products.
insert into public.household_products (
  household_id,
  product_id,
  is_basis,
  desired_stock,
  target_price,
  target_price_unit,
  preferred_store,
  is_freezable,
  notes,
  created_at,
  updated_at
)
select
  p.household_id,
  p.id as product_id,
  coalesce(p.is_basis, false) as is_basis,
  p.desired_stock,
  p.target_price,
  p.target_price_unit,
  p.preferred_store,
  coalesce(p.is_freezable, false) as is_freezable,
  p.notes,
  p.created_at,
  now()
from public.products p
where p.household_id is not null
on conflict (household_id, product_id) do update
set
  is_basis = excluded.is_basis,
  desired_stock = excluded.desired_stock,
  target_price = excluded.target_price,
  target_price_unit = excluded.target_price_unit,
  preferred_store = excluded.preferred_store,
  is_freezable = excluded.is_freezable,
  notes = excluded.notes,
  updated_at = now();

-- Add source/scope metadata to price observations.
-- household_id is the household that owns a private observation, when relevant.
-- observed_by_household_id is who caused/created the observation, useful for filtering
-- public prices from other households without exposing private receipt context.
alter table public.price_observations
  add column if not exists household_id uuid references public.households(id) on delete set null,
  add column if not exists observed_by_household_id uuid references public.households(id) on delete set null,
  add column if not exists scope text not null default 'global',
  add column if not exists visibility text not null default 'public';

-- Add lightweight constraints idempotently.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'price_observations_scope_check'
  ) then
    alter table public.price_observations
      add constraint price_observations_scope_check
      check (scope in ('global', 'household'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'price_observations_visibility_check'
  ) then
    alter table public.price_observations
      add constraint price_observations_visibility_check
      check (visibility in ('public', 'private'));
  end if;
end $$;

-- Backfill price metadata from the product's current household.
-- Kassalapp and observed prices are treated as shareable price observations.
-- Private raw/context should not be exposed by API responses; that is handled in code later.
update public.price_observations po
set
  observed_by_household_id = coalesce(po.observed_by_household_id, p.household_id),
  household_id = case
    when lower(coalesce(po.source, '')) in ('manual-private') then p.household_id
    else po.household_id
  end,
  scope = case
    when lower(coalesce(po.source, '')) in ('manual-private') then 'household'
    else 'global'
  end,
  visibility = case
    when lower(coalesce(po.source, '')) in ('manual-private') then 'private'
    else 'public'
  end
from public.products p
where po.product_id = p.id;

create index if not exists price_observations_scope_visibility_idx
  on public.price_observations (scope, visibility, observed_at desc);

create index if not exists price_observations_household_idx
  on public.price_observations (household_id, observed_at desc)
  where household_id is not null;

create index if not exists price_observations_observed_by_household_idx
  on public.price_observations (observed_by_household_id, observed_at desc)
  where observed_by_household_id is not null;

-- Household-level controls for which price sources are used in comparisons.
create table if not exists public.household_price_source_preferences (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid not null references public.households(id) on delete cascade,

  include_kassalapp boolean not null default true,
  include_own_shelf_edge boolean not null default true,
  include_other_shelf_edge boolean not null default true,
  include_own_receipt boolean not null default true,
  include_other_receipt boolean not null default false,
  include_own_manual boolean not null default true,
  include_other_manual boolean not null default false,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (household_id)
);

create index if not exists household_price_source_preferences_household_idx
  on public.household_price_source_preferences (household_id);

-- Backfill one preference row per household.
insert into public.household_price_source_preferences (household_id)
select h.id
from public.households h
on conflict (household_id) do nothing;

commit;

-- Verification queries you can run after this patch:
--
-- select count(*) as household_products_count from public.household_products;
--
-- select scope, visibility, source, count(*)
-- from public.price_observations
-- group by scope, visibility, source
-- order by count(*) desc;
--
-- select * from public.household_price_source_preferences;
