-- patch-024-fix-coca-cola-zero-15l-unit-price.sql
-- One-time cleanup for old unit-price rows where a 1.5l bottle was wrongly treated as 6 x 1.5l = 9l.
-- Safe to run more than once.

begin;

update public.price_observations po
set
  unit_price = round((po.price / 1.5)::numeric, 2),
  package_quantity = 1.5,
  package_unit = 'l',
  comparison_unit = 'l',
  unit_price_source = case
    when po.unit_price_source = 'computed' then 'computed'
    else po.unit_price_source
  end,
  raw = coalesce(po.raw, '{}'::jsonb)
    || jsonb_build_object(
      'unit_pricing_cleanup',
      jsonb_build_object(
        'patch', 'patch-024-fix-coca-cola-zero-15l-unit-price',
        'fixed_at', now(),
        'previous_unit_price', po.unit_price,
        'previous_package_quantity', po.package_quantity,
        'previous_package_unit', po.package_unit,
        'reason', 'Produktet er 1,5l flaske, men gammel beregning tolket den som 6 x 1,5l.'
      )
    )
from public.products p
where
  p.id = po.product_id
  and lower(coalesce(p.name, '')) like '%coca-cola zero%1,5l%flaske%'
  and lower(coalesce(p.name, '')) not like '%x4%'
  and lower(coalesce(p.name, '')) not like '%x6%'
  and lower(coalesce(p.name, '')) not like '%6x%'
  and coalesce(p.package_size, '') in ('1500 ml', '1500ml', '1.5 l', '1,5 l', '1.5l', '1,5l')
  and po.price is not null
  and po.comparison_unit = 'l'
  and po.package_unit = 'l'
  and po.package_quantity = 9
  and po.unit_price is not null;

commit;

-- Verification:
-- select
--   p.name,
--   p.package_size,
--   po.store_name,
--   po.price,
--   po.unit_price,
--   po.comparison_unit,
--   po.package_quantity,
--   po.package_unit,
--   po.unit_price_source,
--   po.source,
--   po.observed_at,
--   po.raw -> 'unit_pricing_cleanup' as cleanup
-- from public.price_observations po
-- join public.products p on p.id = po.product_id
-- where lower(p.name) like '%coca-cola zero%1,5l%flaske%'
-- order by po.observed_at desc;
