-- patch-039-price-data-quality-guards.sql
-- UI/API quality guards for price observations. Safe to run after patch 038.

alter table public.price_observations
  add column if not exists exclude_from_analysis boolean not null default false,
  add column if not exists confidence text not null default 'high';

update public.price_observations
set confidence = coalesce(confidence, 'high'),
    exclude_from_analysis = coalesce(exclude_from_analysis, false);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'price_observations_confidence_quality_check'
  ) then
    alter table public.price_observations
      add constraint price_observations_confidence_quality_check
      check (confidence in ('high', 'medium', 'low', 'unknown'));
  end if;
end $$;

create index if not exists price_observations_analysis_current_idx
on public.price_observations (product_id, store_code, observed_at desc)
where exclude_from_analysis = false;
