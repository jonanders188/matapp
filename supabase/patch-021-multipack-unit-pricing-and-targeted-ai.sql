-- patch-021-multipack-unit-pricing-and-targeted-ai.sql
-- Backfills common multipack unit pricing cases, e.g. "6pk 1.5l" and "6x0,33l".
-- Safe to rerun.

begin;

with base as (
  select
    po.id,
    po.price::numeric as price,
    lower(
      coalesce(p.package_size, '') || ' ' || coalesce(p.name, '')
    ) as text_value
  from public.price_observations po
  join public.products p on p.id = po.product_id
  where po.price is not null
    and po.price::numeric > 0
    and (
      lower(coalesce(p.name, '')) ~ '([0-9]+)\s*(pk|pakk|pakke|pakker)'
      or lower(coalesce(p.name, '')) ~ '([0-9]+)\s*x\s*([0-9]+([\.,][0-9]+)?)\s*(kg|g|l|liter|litre|ltr|dl|cl|ml)'
    )
),
matches as (
  select
    id,
    price,
    regexp_match(
      text_value,
      '([0-9]+)\s*(?:pk|pakk|pakke|pakker)\s*(?:a|à|x)?\s*([0-9]+(?:[\.,][0-9]+)?)\s*(kg|kilo|kilogram|g|gram|l|liter|litre|ltr|dl|cl|ml)\y'
    ) as m,
    1 as pattern_order
  from base

  union all

  select
    id,
    price,
    regexp_match(
      text_value,
      '([0-9]+)\s*x\s*([0-9]+(?:[\.,][0-9]+)?)\s*(kg|kilo|kilogram|g|gram|l|liter|litre|ltr|dl|cl|ml)\y'
    ) as m,
    2 as pattern_order
  from base

  union all

  select
    id,
    price,
    regexp_match(
      text_value,
      '([0-9]+(?:[\.,][0-9]+)?)\s*(kg|kilo|kilogram|g|gram|l|liter|litre|ltr|dl|cl|ml)\s*(?:flaske|boks|stk)?\s*([0-9]+)\s*(?:pk|pakk|pakke|pakker)\y'
    ) as m,
    3 as pattern_order
  from base
),
chosen as (
  select distinct on (id)
    id,
    price,
    m,
    pattern_order
  from matches
  where m is not null
  order by id, pattern_order
),
parsed as (
  select
    id,
    price,
    case when pattern_order = 3 then replace(m[3], ',', '.')::numeric else replace(m[1], ',', '.')::numeric end as pack_count,
    case when pattern_order = 3 then replace(m[1], ',', '.')::numeric else replace(m[2], ',', '.')::numeric end as amount_each,
    case
      when pattern_order = 3 and m[2] in ('kg', 'kilo', 'kilogram') then 'kg'
      when pattern_order = 3 and m[2] in ('g', 'gram') then 'g'
      when pattern_order = 3 and m[2] in ('l', 'liter', 'litre', 'ltr') then 'l'
      when pattern_order = 3 and m[2] = 'dl' then 'dl'
      when pattern_order = 3 and m[2] = 'cl' then 'cl'
      when pattern_order = 3 and m[2] = 'ml' then 'ml'
      when pattern_order <> 3 and m[3] in ('kg', 'kilo', 'kilogram') then 'kg'
      when pattern_order <> 3 and m[3] in ('g', 'gram') then 'g'
      when pattern_order <> 3 and m[3] in ('l', 'liter', 'litre', 'ltr') then 'l'
      when pattern_order <> 3 and m[3] = 'dl' then 'dl'
      when pattern_order <> 3 and m[3] = 'cl' then 'cl'
      when pattern_order <> 3 and m[3] = 'ml' then 'ml'
      else null
    end as package_unit
  from chosen
),
converted as (
  select
    id,
    price,
    pack_count,
    amount_each,
    amount_each * pack_count as package_quantity,
    package_unit,
    case
      when package_unit in ('kg', 'g') then 'kg'
      when package_unit in ('l', 'dl', 'cl', 'ml') then 'l'
      else null
    end as comparison_unit,
    case
      when package_unit = 'kg' then amount_each * pack_count
      when package_unit = 'g' then amount_each * pack_count / 1000
      when package_unit = 'l' then amount_each * pack_count
      when package_unit = 'dl' then amount_each * pack_count / 10
      when package_unit = 'cl' then amount_each * pack_count / 100
      when package_unit = 'ml' then amount_each * pack_count / 1000
      else null
    end as comparison_quantity
  from parsed
  where pack_count > 1
    and amount_each > 0
)
update public.price_observations po
set
  unit_price = round((converted.price / converted.comparison_quantity)::numeric, 2),
  comparison_unit = converted.comparison_unit,
  package_quantity = converted.package_quantity,
  package_unit = converted.package_unit,
  unit_price_source = 'computed',
  raw = jsonb_set(
    coalesce(po.raw, '{}'::jsonb),
    '{unit_pricing}',
    jsonb_build_object(
      'package_unit', converted.package_unit,
      'comparison_unit', converted.comparison_unit,
      'package_quantity', converted.package_quantity,
      'unit_price_label', case
        when converted.comparison_unit = 'kg' then 'kr/kg'
        when converted.comparison_unit = 'l' then 'kr/l'
        else null
      end,
      'unit_price_reason', 'Beregnet fra multipakning: ' || converted.pack_count || ' x ' || converted.amount_each || ' ' || converted.package_unit || '.',
      'unit_price_source', 'computed'
    )
  )
from converted
where po.id = converted.id
  and converted.comparison_quantity is not null
  and converted.comparison_quantity > 0;

commit;
