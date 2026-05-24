-- patch-019-backfill-unit-pricing.sql
-- Backfills unit pricing metadata for old price_observations.
-- Safe to rerun. Does not create new price observations.

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

-- Weight/volume first. This intentionally wins over count for products like
-- "Løk Gul 2stk 450g", because kg is the better comparison unit there.
with base as (
  select
    po.id,
    po.price::numeric as price,
    regexp_match(
      lower(coalesce(p.package_size, '') || ' ' || coalesce(p.name, '')),
      '([0-9]+(?:[\.,][0-9]+)?)\s*(kg|kilo|kilogram|g|gram|l|liter|litre|dl|cl|ml)\y'
    ) as m
  from public.price_observations po
  join public.products p on p.id = po.product_id
  where po.price is not null
    and po.price::numeric > 0
    and (
      po.unit_price_source is null
      or po.comparison_unit is null
      or po.package_quantity is null
      or po.package_quantity = 716
    )
),
parsed as (
  select
    id,
    price,
    replace(m[1], ',', '.')::numeric as amount,
    case
      when m[2] in ('kg', 'kilo', 'kilogram') then 'kg'
      when m[2] in ('g', 'gram') then 'g'
      when m[2] in ('l', 'liter', 'litre') then 'l'
      when m[2] = 'dl' then 'dl'
      when m[2] = 'cl' then 'cl'
      when m[2] = 'ml' then 'ml'
      else m[2]
    end as package_unit,
    case
      when m[2] in ('kg', 'kilo', 'kilogram', 'g', 'gram') then 'kg'
      when m[2] in ('l', 'liter', 'litre', 'dl', 'cl', 'ml') then 'l'
      else null
    end as comparison_unit,
    case
      when m[2] in ('kg', 'kilo', 'kilogram') then replace(m[1], ',', '.')::numeric
      when m[2] in ('g', 'gram') then replace(m[1], ',', '.')::numeric / 1000
      when m[2] in ('l', 'liter', 'litre') then replace(m[1], ',', '.')::numeric
      when m[2] = 'dl' then replace(m[1], ',', '.')::numeric / 10
      when m[2] = 'cl' then replace(m[1], ',', '.')::numeric / 100
      when m[2] = 'ml' then replace(m[1], ',', '.')::numeric / 1000
      else null
    end as comparison_quantity
  from base
  where m is not null
)
update public.price_observations po
set
  unit_price = round((parsed.price / parsed.comparison_quantity)::numeric, 2),
  comparison_unit = parsed.comparison_unit,
  package_quantity = parsed.amount,
  package_unit = parsed.package_unit,
  unit_price_source = 'computed',
  raw = jsonb_set(
    coalesce(po.raw, '{}'::jsonb),
    '{unit_pricing}',
    jsonb_build_object(
      'package_unit', parsed.package_unit,
      'comparison_unit', parsed.comparison_unit,
      'package_quantity', parsed.amount,
      'unit_price_label', case
        when parsed.comparison_unit = 'kg' then 'kr/kg'
        when parsed.comparison_unit = 'l' then 'kr/l'
        when parsed.comparison_unit = 'stk' then 'kr/stk'
        else null
      end,
      'unit_price_reason', 'Beregnet fra pakkepris og ' || parsed.amount || ' ' || parsed.package_unit || '.',
      'unit_price_source', 'computed'
    )
  )
from parsed
where po.id = parsed.id
  and parsed.comparison_quantity is not null
  and parsed.comparison_quantity > 0;

-- Count-based units. Do not compact the text here, otherwise "Str.7 16stk"
-- can become "716stk". This fixes older wrong 716 rows too.
with base as (
  select
    po.id,
    po.price::numeric as price,
    regexp_match(
      lower(coalesce(p.package_size, '') || ' ' || coalesce(p.name, '')),
      '(^|\s)([0-9]+)\s*(stk|pk|pakk|pakke|pakker|rl|rull|ruller|egg|bleie|bleier|tablett|tabletter|tabs|vask)\y'
    ) as m
  from public.price_observations po
  join public.products p on p.id = po.product_id
  where po.price is not null
    and po.price::numeric > 0
    and (
      po.unit_price_source is null
      or po.comparison_unit is null
      or po.package_quantity is null
      or po.package_quantity = 716
    )
),
parsed as (
  select
    id,
    price,
    m[2]::numeric as amount
  from base
  where m is not null
)
update public.price_observations po
set
  unit_price = round((parsed.price / parsed.amount)::numeric, 2),
  comparison_unit = 'stk',
  package_quantity = parsed.amount,
  package_unit = 'stk',
  unit_price_source = 'computed',
  raw = jsonb_set(
    coalesce(po.raw, '{}'::jsonb),
    '{unit_pricing}',
    jsonb_build_object(
      'package_unit', 'stk',
      'comparison_unit', 'stk',
      'package_quantity', parsed.amount,
      'unit_price_label', 'kr/stk',
      'unit_price_reason', 'Beregnet fra pakkepris og ' || parsed.amount || ' stk.',
      'unit_price_source', 'computed'
    )
  )
from parsed
where po.id = parsed.id
  and parsed.amount > 0;

commit;
