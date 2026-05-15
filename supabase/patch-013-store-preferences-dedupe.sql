-- Dedupe store preferences and prevent duplicate store keys per household.
-- Safe to run multiple times.

begin;

with ranked as (
  select
    p.id,
    row_number() over (
      partition by p.household_id, lower(trim(p.store_key))
      order by
        p.is_enabled desc,
        p.priority asc,
        p.created_at asc nulls last,
        p.id asc
    ) as rn,
    min(p.priority) over (
      partition by p.household_id, lower(trim(p.store_key))
    ) as best_priority,
    bool_or(p.is_enabled) over (
      partition by p.household_id, lower(trim(p.store_key))
    ) as should_be_enabled
  from public.household_store_preferences p
),
normalize_kept as (
  update public.household_store_preferences p
  set
    store_key = lower(trim(p.store_key)),
    store_name = case
      when lower(trim(p.store_key)) = 'kiwi' then 'KIWI'
      when lower(trim(p.store_key)) = 'rema_1000' then 'REMA 1000'
      when lower(trim(p.store_key)) = 'meny_no' then 'Meny'
      when lower(trim(p.store_key)) = 'oda_no' then 'Oda'
      when lower(trim(p.store_key)) = 'spar_no' then 'SPAR'
      when lower(trim(p.store_key)) = 'joker_no' then 'Joker'
      when lower(trim(p.store_key)) = 'europris_no' then 'Europris'
      when lower(trim(p.store_key)) = 'bunnpris' then 'Bunnpris'
      when lower(trim(p.store_key)) = 'engrossnett_no' then 'Engrosnett'
      when lower(trim(p.store_key)) = 'coop_no' then 'Coop'
      else trim(p.store_name)
    end,
    priority = r.best_priority,
    is_enabled = r.should_be_enabled,
    updated_at = now()
  from ranked r
  where p.id = r.id
    and r.rn = 1
  returning p.id
),
deleted_duplicates as (
  delete from public.household_store_preferences p
  using ranked r
  where p.id = r.id
    and r.rn > 1
  returning p.id
)
select
  (select count(*) from normalize_kept) as kept_rows_updated,
  (select count(*) from deleted_duplicates) as duplicate_rows_deleted;

create unique index if not exists household_store_preferences_unique_normalized_store_key
on public.household_store_preferences (
  household_id,
  lower(trim(store_key))
);

commit;
