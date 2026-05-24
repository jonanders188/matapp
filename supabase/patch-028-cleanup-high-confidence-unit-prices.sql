-- patch-028-cleanup-high-confidence-unit-prices.sql
-- Retter bare high-confidence unit_price-feil fra public.suspicious_unit_price_observations.
-- Forutsetter at patch-027-viewet finnes.
--
-- Viktig:
-- - Kjores etter at rapporten er kontrollert.
-- - Logger gamle verdier i raw.unit_pricing_cleanup.
-- - Retter ikke medium/low confidence.

begin;

-- 1) Forhandsvis radene som blir rettet.
select
  price_observation_id,
  product_name,
  product_package_size,
  store_name,
  price,
  stored_unit_price,
  expected_unit_price,
  deviation_percent,
  stored_package_quantity,
  expected_package_quantity,
  stored_package_unit,
  expected_comparison_unit,
  confidence,
  inference_source,
  issue_type,
  source,
  observed_at
from public.suspicious_unit_price_observations
where confidence = 'high'
  and issue_type in ('moderate_deviation', 'large_deviation', 'very_large_deviation')
  and expected_unit_price is not null
  and expected_package_quantity is not null
  and expected_comparison_unit is not null
  and coalesce(stored_comparison_unit, expected_comparison_unit) = expected_comparison_unit
order by deviation_percent desc nulls last;

-- 2) Oppdater high-confidence-rader.
with candidates as (
  select
    price_observation_id,
    product_name,
    product_package_size,
    store_name,
    price,
    stored_unit_price,
    expected_unit_price,
    deviation_percent,
    stored_comparison_unit,
    expected_comparison_unit,
    stored_package_quantity,
    expected_package_quantity,
    stored_package_unit,
    case
      when expected_comparison_unit = 'kg' then 'kg'
      when expected_comparison_unit = 'l' then 'l'
      when expected_comparison_unit = 'stk' then 'stk'
      else expected_comparison_unit
    end as expected_package_unit,
    unit_price_source,
    confidence,
    inference_source,
    issue_type,
    source,
    observed_at
  from public.suspicious_unit_price_observations
  where confidence = 'high'
    and issue_type in ('moderate_deviation', 'large_deviation', 'very_large_deviation')
    and expected_unit_price is not null
    and expected_package_quantity is not null
    and expected_comparison_unit is not null
    and coalesce(stored_comparison_unit, expected_comparison_unit) = expected_comparison_unit
), updated as (
  update public.price_observations po
  set
    unit_price = round(c.expected_unit_price::numeric, 2),
    comparison_unit = c.expected_comparison_unit,
    package_quantity = c.expected_package_quantity,
    package_unit = c.expected_package_unit,
    unit_price_source = 'computed-cleanup',
    raw = jsonb_set(
      coalesce(po.raw, '{}'::jsonb),
      '{unit_pricing_cleanup}',
      jsonb_build_object(
        'patch', 'patch-028-cleanup-high-confidence-unit-prices',
        'cleaned_at', now(),
        'reason', 'Corrected high-confidence suspicious unit_price from report view',
        'product_name', c.product_name,
        'product_package_size', c.product_package_size,
        'store_name', c.store_name,
        'price', c.price,
        'old_unit_price', c.stored_unit_price,
        'new_unit_price', round(c.expected_unit_price::numeric, 2),
        'old_comparison_unit', c.stored_comparison_unit,
        'new_comparison_unit', c.expected_comparison_unit,
        'old_package_quantity', c.stored_package_quantity,
        'new_package_quantity', c.expected_package_quantity,
        'old_package_unit', c.stored_package_unit,
        'new_package_unit', c.expected_package_unit,
        'old_unit_price_source', c.unit_price_source,
        'confidence', c.confidence,
        'inference_source', c.inference_source,
        'issue_type', c.issue_type,
        'deviation_percent', c.deviation_percent
      ),
      true
    )
  from candidates c
  where po.id = c.price_observation_id
  returning
    po.id,
    c.product_name,
    c.store_name,
    c.price,
    c.stored_unit_price as old_unit_price,
    po.unit_price as new_unit_price,
    c.stored_package_quantity as old_package_quantity,
    po.package_quantity as new_package_quantity,
    c.expected_comparison_unit as comparison_unit,
    c.deviation_percent,
    c.issue_type
)
select *
from updated
order by deviation_percent desc nulls last;

commit;

-- 3) Verifisering etter commit.
-- Denne skal helst returnere 0 rader for high-confidence deviation-feil.
select
  issue_type,
  confidence,
  count(*) as count
from public.suspicious_unit_price_observations
where confidence = 'high'
  and issue_type in ('moderate_deviation', 'large_deviation', 'very_large_deviation')
group by issue_type, confidence
order by count desc;

-- Ekstra stikkprover.
select
  po.id,
  p.name,
  p.package_size,
  po.store_name,
  po.price,
  po.unit_price,
  po.comparison_unit,
  po.package_quantity,
  po.package_unit,
  po.unit_price_source,
  po.raw -> 'unit_pricing_cleanup' as cleanup,
  po.observed_at
from public.price_observations po
join public.products p on p.id = po.product_id
where po.raw ? 'unit_pricing_cleanup'
  and po.raw -> 'unit_pricing_cleanup' ->> 'patch' = 'patch-028-cleanup-high-confidence-unit-prices'
order by po.observed_at desc, p.name
limit 100;
