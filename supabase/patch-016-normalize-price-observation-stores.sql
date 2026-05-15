-- Normalize historic price observation store keys so every view uses the same store identity.
-- Especially fixes KIWI/kiwi duplicates and maps display-name-only stores to canonical store_code.

update public.price_observations
set
  store_code = case
    when lower(trim(coalesce(store_code, store_name))) in ('kiwi') then 'kiwi'
    when regexp_replace(lower(trim(coalesce(store_code, store_name))), '[^a-z0-9]+', '', 'g') in ('rema', 'rema1000') then 'rema_1000'
    when lower(trim(coalesce(store_code, store_name))) in ('rema_1000') then 'rema_1000'
    when lower(trim(coalesce(store_code, store_name))) in ('meny', 'meny_no') then 'meny_no'
    when lower(trim(coalesce(store_code, store_name))) in ('coop', 'coop_no') then 'coop_no'
    when lower(trim(coalesce(store_code, store_name))) in ('oda', 'oda_no') then 'oda_no'
    when lower(trim(coalesce(store_code, store_name))) in ('spar', 'spar_no') then 'spar_no'
    when lower(trim(coalesce(store_code, store_name))) in ('joker', 'joker_no') then 'joker_no'
    when lower(trim(coalesce(store_code, store_name))) in ('europris', 'europris_no') then 'europris_no'
    when lower(trim(coalesce(store_code, store_name))) in ('bunnpris') then 'bunnpris'
    when lower(trim(coalesce(store_code, store_name))) in ('engrosnett', 'engrossnett', 'engrossnett_no') then 'engrossnett_no'
    else lower(trim(coalesce(store_code, store_name)))
  end,
  store_name = case
    when lower(trim(coalesce(store_code, store_name))) in ('kiwi') then 'KIWI'
    when regexp_replace(lower(trim(coalesce(store_code, store_name))), '[^a-z0-9]+', '', 'g') in ('rema', 'rema1000') then 'REMA 1000'
    when lower(trim(coalesce(store_code, store_name))) in ('rema_1000') then 'REMA 1000'
    when lower(trim(coalesce(store_code, store_name))) in ('meny', 'meny_no') then 'Meny'
    when lower(trim(coalesce(store_code, store_name))) in ('coop', 'coop_no') then 'Coop'
    when lower(trim(coalesce(store_code, store_name))) in ('oda', 'oda_no') then 'Oda'
    when lower(trim(coalesce(store_code, store_name))) in ('spar', 'spar_no') then 'SPAR'
    when lower(trim(coalesce(store_code, store_name))) in ('joker', 'joker_no') then 'Joker'
    when lower(trim(coalesce(store_code, store_name))) in ('europris', 'europris_no') then 'Europris'
    when lower(trim(coalesce(store_code, store_name))) in ('bunnpris') then 'Bunnpris'
    when lower(trim(coalesce(store_code, store_name))) in ('engrosnett', 'engrossnett', 'engrossnett_no') then 'Engrosnett'
    else store_name
  end
where coalesce(store_code, store_name) is not null;

select
  store_code,
  store_name,
  count(*) as count,
  max(observed_at) as latest_observed_at
from public.price_observations
group by store_code, store_name
order by store_code, store_name;
