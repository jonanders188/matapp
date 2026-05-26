-- Patch 052: sysadmin user metrics
-- Adds an aggregate helper for /admin/users without exposing row-level data to the client.

create or replace function public.system_admin_user_metrics(target_user_ids uuid[])
returns table (
  user_id uuid,
  basis_product_count bigint,
  scanned_price_count bigint,
  manual_price_count bigint,
  receipt_price_count bigint,
  user_registered_price_count bigint
)
language sql
security definer
set search_path = public
as $$
  with user_households as (
    select distinct hm.user_id, hm.household_id
    from public.household_members hm
    where hm.user_id = any(target_user_ids)
  ),
  basis_counts as (
    select
      uh.user_id,
      count(distinct hp.product_id) as basis_product_count
    from user_households uh
    join public.household_products hp
      on hp.household_id = uh.household_id
    where hp.is_basis = true
    group by uh.user_id
  ),
  price_rows as (
    select distinct
      uh.user_id,
      po.id,
      lower(coalesce(po.source, '')) as source
    from user_households uh
    join public.price_observations po
      on po.observed_by_household_id = uh.household_id
      or (po.observed_by_household_id is null and po.household_id = uh.household_id)
  ),
  price_counts as (
    select
      pr.user_id,
      count(*) filter (
        where pr.source in ('shelf-edge', 'mobile-scan')
           or pr.source like '%shelf%'
      ) as scanned_price_count,
      count(*) filter (
        where pr.source like '%manual%'
      ) as manual_price_count,
      count(*) filter (
        where pr.source like '%receipt%'
      ) as receipt_price_count,
      count(*) filter (
        where pr.source like '%manual%'
           or pr.source like '%receipt%'
           or pr.source in ('shelf-edge', 'mobile-scan')
           or pr.source like '%shelf%'
      ) as user_registered_price_count
    from price_rows pr
    group by pr.user_id
  )
  select
    ids.user_id,
    coalesce(bc.basis_product_count, 0)::bigint as basis_product_count,
    coalesce(pc.scanned_price_count, 0)::bigint as scanned_price_count,
    coalesce(pc.manual_price_count, 0)::bigint as manual_price_count,
    coalesce(pc.receipt_price_count, 0)::bigint as receipt_price_count,
    coalesce(pc.user_registered_price_count, 0)::bigint as user_registered_price_count
  from unnest(target_user_ids) as ids(user_id)
  left join basis_counts bc on bc.user_id = ids.user_id
  left join price_counts pc on pc.user_id = ids.user_id;
$$;

grant execute on function public.system_admin_user_metrics(uuid[]) to service_role;
