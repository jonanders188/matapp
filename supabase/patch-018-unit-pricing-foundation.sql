-- patch-018-unit-pricing-foundation.sql
-- Adds explicit unit-pricing metadata so prices can be compared across different EAN/package sizes.
-- Run in Supabase SQL editor before deploying code that writes these columns.

begin;

alter table public.products
  add column if not exists net_content_value numeric,
  add column if not exists net_content_unit text,
  add column if not exists comparison_unit text,
  add column if not exists unit_pricing_note text;

alter table public.price_observations
  add column if not exists comparison_unit text,
  add column if not exists package_quantity numeric,
  add column if not exists package_unit text,
  add column if not exists unit_price_source text;

create index if not exists idx_price_observations_product_unit
  on public.price_observations(product_id, comparison_unit, observed_at desc);

commit;
