-- Run after existing product duplicates have been merged.
create unique index if not exists products_unique_normalized_ean
on public.products (lower(trim(ean)))
where ean is not null
  and trim(ean) <> '';
