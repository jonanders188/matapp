-- patch-027-improve-suspicious-unit-price-report.sql
-- Purpose:
--   Replace the first suspicious unit-price report with a safer version.
--   The old report produced false positives when products.package_size was numeric-only
--   (for example '350' while the name said '350g', or '9000' while the name said '1,5lx6').
--
-- This patch DOES NOT update data. It only rebuilds the report view.

begin;

drop view if exists public.suspicious_unit_price_observations;

create or replace view public.suspicious_unit_price_observations as
with base as (
  select
    po.id as price_observation_id,
    po.product_id,
    p.name as product_name,
    p.package_size as product_package_size,
    po.store_name,
    po.store_code,
    po.price::numeric as price,
    po.unit_price::numeric as stored_unit_price,
    po.comparison_unit as stored_comparison_unit,
    po.package_quantity::numeric as stored_package_quantity,
    po.package_unit as stored_package_unit,
    po.unit_price_source,
    po.source,
    po.observed_at,
    po.raw,
    lower(coalesce(p.name, '')) as name_lc,
    lower(coalesce(p.package_size, '')) as package_size_lc
  from public.price_observations po
  join public.products p on p.id = po.product_id
  where po.price is not null
    and po.price::numeric > 0
), matches as (
  select
    b.*,
    regexp_match(b.package_size_lc, '^\s*([0-9]+(?:[\.,][0-9]+)?)\s*(kg|g|gram|l|liter|ml|stk|pk|pack)\s*$') as ps_unit_match,
    regexp_match(b.package_size_lc, '^\s*([0-9]+(?:[\.,][0-9]+)?)\s*$') as ps_number_match,
    regexp_match(b.name_lc, '([0-9]+(?:[\.,][0-9]+)?)\s*l\s*x\s*([0-9]+)') as name_lx_match,
    regexp_match(b.name_lc, '([0-9]+(?:[\.,][0-9]+)?)\s*x\s*([0-9]+)\s*(l|liter|flaske)') as name_xl_match,
    regexp_match(b.name_lc, '([0-9]+(?:[\.,][0-9]+)?)\s*(kg)') as name_kg_match,
    regexp_match(b.name_lc, '([0-9]+(?:[\.,][0-9]+)?)\s*(g|gram)') as name_g_match,
    regexp_match(b.name_lc, '([0-9]+(?:[\.,][0-9]+)?)\s*(ml)') as name_ml_match,
    regexp_match(b.name_lc, '([0-9]+(?:[\.,][0-9]+)?)\s*(l|liter)') as name_l_match,
    regexp_match(b.name_lc, '([0-9]+)\s*(stk|pk|pack)') as name_stk_match
  from base b
), inferred as (
  select
    m.*,
    case
      -- Explicit package_size with unit, for example '1500 ml', '350 g', '1.5 l'.
      when ps_unit_match is not null and ps_unit_match[2] in ('g', 'gram') then replace(ps_unit_match[1], ',', '.')::numeric / 1000.0
      when ps_unit_match is not null and ps_unit_match[2] = 'kg' then replace(ps_unit_match[1], ',', '.')::numeric
      when ps_unit_match is not null and ps_unit_match[2] = 'ml' then replace(ps_unit_match[1], ',', '.')::numeric / 1000.0
      when ps_unit_match is not null and ps_unit_match[2] in ('l', 'liter') then replace(ps_unit_match[1], ',', '.')::numeric
      when ps_unit_match is not null and ps_unit_match[2] in ('stk', 'pk', 'pack') then replace(ps_unit_match[1], ',', '.')::numeric

      -- Numeric-only package_size. Infer unit from product name.
      -- Examples:
      --   package_size='350', name='... 350g ...'        => 0.35 kg
      --   package_size='220', name='... 220ml ...'       => 0.22 l
      --   package_size='9000', name='... 1,5lx6 ...'     => 9 l
      when ps_number_match is not null
        and name_lx_match is not null
        and replace(ps_number_match[1], ',', '.')::numeric >= 1000
        then replace(ps_number_match[1], ',', '.')::numeric / 1000.0
      when ps_number_match is not null
        and name_xl_match is not null
        and replace(ps_number_match[1], ',', '.')::numeric >= 1000
        then replace(ps_number_match[1], ',', '.')::numeric / 1000.0
      when ps_number_match is not null
        and name_g_match is not null
        and abs(replace(name_g_match[1], ',', '.')::numeric - replace(ps_number_match[1], ',', '.')::numeric) <= greatest(1, replace(ps_number_match[1], ',', '.')::numeric * 0.02)
        then replace(ps_number_match[1], ',', '.')::numeric / 1000.0
      when ps_number_match is not null
        and name_ml_match is not null
        and abs(replace(name_ml_match[1], ',', '.')::numeric - replace(ps_number_match[1], ',', '.')::numeric) <= greatest(1, replace(ps_number_match[1], ',', '.')::numeric * 0.02)
        then replace(ps_number_match[1], ',', '.')::numeric / 1000.0
      when ps_number_match is not null
        and name_l_match is not null
        and replace(ps_number_match[1], ',', '.')::numeric >= 1000
        then replace(ps_number_match[1], ',', '.')::numeric / 1000.0

      -- Name-only inference. Prefer grams/ml/l over stk because many products are named
      -- like '2stk 450g', where kg is the useful comparison unit.
      when name_lx_match is not null then replace(name_lx_match[1], ',', '.')::numeric * replace(name_lx_match[2], ',', '.')::numeric
      when name_xl_match is not null then replace(name_xl_match[1], ',', '.')::numeric * replace(name_xl_match[2], ',', '.')::numeric
      when name_kg_match is not null then replace(name_kg_match[1], ',', '.')::numeric
      when name_g_match is not null then replace(name_g_match[1], ',', '.')::numeric / 1000.0
      when name_ml_match is not null then replace(name_ml_match[1], ',', '.')::numeric / 1000.0
      when name_l_match is not null then replace(name_l_match[1], ',', '.')::numeric
      when name_stk_match is not null then replace(name_stk_match[1], ',', '.')::numeric
      else null
    end as expected_package_quantity,

    case
      when ps_unit_match is not null and ps_unit_match[2] in ('g', 'gram', 'kg') then 'kg'
      when ps_unit_match is not null and ps_unit_match[2] in ('ml', 'l', 'liter') then 'l'
      when ps_unit_match is not null and ps_unit_match[2] in ('stk', 'pk', 'pack') then 'stk'

      when ps_number_match is not null and name_lx_match is not null and replace(ps_number_match[1], ',', '.')::numeric >= 1000 then 'l'
      when ps_number_match is not null and name_xl_match is not null and replace(ps_number_match[1], ',', '.')::numeric >= 1000 then 'l'
      when ps_number_match is not null and name_g_match is not null and abs(replace(name_g_match[1], ',', '.')::numeric - replace(ps_number_match[1], ',', '.')::numeric) <= greatest(1, replace(ps_number_match[1], ',', '.')::numeric * 0.02) then 'kg'
      when ps_number_match is not null and name_ml_match is not null and abs(replace(name_ml_match[1], ',', '.')::numeric - replace(ps_number_match[1], ',', '.')::numeric) <= greatest(1, replace(ps_number_match[1], ',', '.')::numeric * 0.02) then 'l'
      when ps_number_match is not null and name_l_match is not null and replace(ps_number_match[1], ',', '.')::numeric >= 1000 then 'l'

      when name_lx_match is not null then 'l'
      when name_xl_match is not null then 'l'
      when name_kg_match is not null then 'kg'
      when name_g_match is not null then 'kg'
      when name_ml_match is not null then 'l'
      when name_l_match is not null then 'l'
      when name_stk_match is not null then 'stk'
      else null
    end as expected_comparison_unit,

    case
      when ps_unit_match is not null then 'product.package_size_with_unit'
      when ps_number_match is not null and name_lx_match is not null and replace(ps_number_match[1], ',', '.')::numeric >= 1000 then 'numeric_package_size_inferred_from_name_multipack_liters'
      when ps_number_match is not null and name_xl_match is not null and replace(ps_number_match[1], ',', '.')::numeric >= 1000 then 'numeric_package_size_inferred_from_name_multipack_liters'
      when ps_number_match is not null and name_g_match is not null and abs(replace(name_g_match[1], ',', '.')::numeric - replace(ps_number_match[1], ',', '.')::numeric) <= greatest(1, replace(ps_number_match[1], ',', '.')::numeric * 0.02) then 'numeric_package_size_inferred_from_name_grams'
      when ps_number_match is not null and name_ml_match is not null and abs(replace(name_ml_match[1], ',', '.')::numeric - replace(ps_number_match[1], ',', '.')::numeric) <= greatest(1, replace(ps_number_match[1], ',', '.')::numeric * 0.02) then 'numeric_package_size_inferred_from_name_ml'
      when ps_number_match is not null and name_l_match is not null and replace(ps_number_match[1], ',', '.')::numeric >= 1000 then 'numeric_package_size_inferred_from_name_liters'
      when name_lx_match is not null then 'product.name_multipack_liters'
      when name_xl_match is not null then 'product.name_multipack_liters'
      when name_kg_match is not null then 'product.name_kg'
      when name_g_match is not null then 'product.name_grams'
      when name_ml_match is not null then 'product.name_ml'
      when name_l_match is not null then 'product.name_liters'
      when name_stk_match is not null then 'product.name_stk'
      else null
    end as inference_source
  from matches m
), calculated as (
  select
    i.*,
    case
      when expected_package_quantity is not null and expected_package_quantity > 0
      then round(price / expected_package_quantity, 2)
      else null
    end as expected_unit_price
  from inferred i
), classified as (
  select
    c.*,
    case
      when expected_unit_price is null then null
      when stored_unit_price is null then null
      when expected_unit_price = 0 then null
      else round(abs(stored_unit_price - expected_unit_price) / expected_unit_price * 100, 1)
    end as deviation_percent,
    case
      when inference_source like 'product.package_size%' then 'high'
      when inference_source like 'numeric_package_size_inferred%' then 'high'
      when inference_source like 'product.name_%' then 'medium'
      else 'low'
    end as confidence,
    case
      when expected_unit_price is null then 'cannot_infer_expected_unit_price'
      when stored_unit_price is null then 'missing_stored_unit_price'
      when abs(stored_unit_price - expected_unit_price) / greatest(expected_unit_price, 0.01) >= 5.0 then 'very_large_deviation'
      when abs(stored_unit_price - expected_unit_price) / greatest(expected_unit_price, 0.01) >= 1.0 then 'large_deviation'
      when abs(stored_unit_price - expected_unit_price) / greatest(expected_unit_price, 0.01) >= 0.3 then 'moderate_deviation'
      else 'ok'
    end as issue_type
  from calculated c
)
select
  price_observation_id,
  product_id,
  product_name,
  product_package_size,
  store_name,
  store_code,
  price,
  stored_unit_price,
  expected_unit_price,
  deviation_percent,
  expected_package_quantity,
  expected_comparison_unit,
  stored_comparison_unit,
  stored_package_quantity,
  stored_package_unit,
  unit_price_source,
  confidence,
  inference_source,
  issue_type,
  source,
  observed_at,
  raw
from classified
where issue_type <> 'ok'
  and issue_type <> 'cannot_infer_expected_unit_price'
order by
  case issue_type
    when 'very_large_deviation' then 1
    when 'large_deviation' then 2
    when 'moderate_deviation' then 3
    when 'missing_stored_unit_price' then 4
    else 5
  end,
  deviation_percent desc nulls last,
  observed_at desc nulls last;

commit;

-- Recommended checks after running:
--
-- 1) Top suspicious rows after improved inference:
-- select product_name, product_package_size, store_name, price, stored_unit_price,
--        expected_unit_price, deviation_percent, expected_package_quantity,
--        expected_comparison_unit, confidence, inference_source, issue_type, source, observed_at
-- from public.suspicious_unit_price_observations
-- order by deviation_percent desc nulls last
-- limit 100;
--
-- 2) Summary:
-- select issue_type, confidence, count(*) as rows
-- from public.suspicious_unit_price_observations
-- group by issue_type, confidence
-- order by issue_type, confidence;
--
-- 3) Check the false positives from patch 026 should now disappear:
-- select product_name, product_package_size, store_name, price, stored_unit_price,
--        expected_unit_price, deviation_percent, expected_package_quantity,
--        expected_comparison_unit, inference_source, issue_type
-- from public.suspicious_unit_price_observations
-- where product_name ilike any (array[
--   '%Stangselleri 350g%',
--   '%Sticky Chicken Korean Bbq Sauce 220ml%',
--   '%Løk Gul 2stk 450g%',
--   '%Coca-Cola Zero 1,5lx6%'
-- ])
-- order by product_name, observed_at desc;
