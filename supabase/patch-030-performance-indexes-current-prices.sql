-- patch-030-performance-indexes-current-prices.sql
-- Purpose: speed up current-price lookups used by mobile scan and product detail pages.
-- Safe to run multiple times.

create index if not exists price_observations_product_observed_idx
on public.price_observations (product_id, observed_at desc);

create index if not exists price_observations_product_store_observed_idx
on public.price_observations (product_id, store_code, observed_at desc);

create index if not exists price_observations_household_product_observed_idx
on public.price_observations (household_id, product_id, observed_at desc)
where household_id is not null;

create index if not exists price_observations_observed_recent_idx
on public.price_observations (observed_at desc);

create index if not exists product_group_members_product_idx
on public.product_group_members (product_id);

create index if not exists product_group_members_group_idx
on public.product_group_members (group_id);

create index if not exists household_store_preferences_household_enabled_idx
on public.household_store_preferences (household_id, is_enabled, priority, store_name);

analyze public.price_observations;
analyze public.product_group_members;
analyze public.household_store_preferences;
