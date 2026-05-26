-- patch-038-price-validity-and-types.sql
-- Step 1: grunnmur for pristype, gyldighet og analysefilter.
-- Endrer ikke eksisterende priser sin oppforsel: alle backfilles som regular/high
-- med valid_from = observed_at og valid_until = null.

alter table public.price_observations
  add column if not exists valid_from timestamptz,
  add column if not exists valid_until timestamptz,
  add column if not exists price_type text not null default 'regular',
  add column if not exists is_campaign boolean not null default false,
  add column if not exists campaign_label text,
  add column if not exists confidence text not null default 'high',
  add column if not exists exclude_from_analysis boolean not null default false;

update public.price_observations
set
  valid_from = coalesce(valid_from, observed_at),
  price_type = coalesce(nullif(price_type, ''), 'regular'),
  is_campaign = coalesce(is_campaign, false),
  confidence = coalesce(nullif(confidence, ''), 'high'),
  exclude_from_analysis = coalesce(exclude_from_analysis, false)
where valid_from is null
   or price_type is null
   or price_type = ''
   or is_campaign is null
   or confidence is null
   or confidence = ''
   or exclude_from_analysis is null;

-- Price type er bevisst litt bredere enn UI i steg 1, slik at vi slipper ny
-- datamigrering naar vi senere legger til medlemspris og 3-for-2.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'price_observations_price_type_check'
  ) then
    alter table public.price_observations
      add constraint price_observations_price_type_check
      check (price_type in ('regular', 'campaign', 'member_price', 'multi_buy', 'clearance', 'unknown'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'price_observations_confidence_check'
  ) then
    alter table public.price_observations
      add constraint price_observations_confidence_check
      check (confidence in ('high', 'medium', 'low', 'unknown'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'price_observations_valid_period_check'
  ) then
    alter table public.price_observations
      add constraint price_observations_valid_period_check
      check (valid_until is null or valid_from is null or valid_until >= valid_from);
  end if;
end $$;

create index if not exists price_observations_effective_product_store_idx
  on public.price_observations (product_id, store_code, price_type, valid_from desc, observed_at desc)
  where exclude_from_analysis = false;

create index if not exists price_observations_valid_until_idx
  on public.price_observations (valid_until)
  where valid_until is not null and exclude_from_analysis = false;

create index if not exists price_observations_price_type_observed_idx
  on public.price_observations (price_type, observed_at desc)
  where exclude_from_analysis = false;

analyze public.price_observations;

-- Verifisering:
-- select price_type, is_campaign, confidence, exclude_from_analysis, count(*)
-- from public.price_observations
-- group by price_type, is_campaign, confidence, exclude_from_analysis
-- order by count(*) desc;
