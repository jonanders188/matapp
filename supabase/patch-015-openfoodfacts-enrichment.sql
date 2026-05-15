alter table public.products
add column if not exists openfoodfacts_raw jsonb,
add column if not exists enrichment_sources jsonb,
add column if not exists data_quality jsonb;

create index if not exists products_openfoodfacts_raw_gin_idx
on public.products using gin (openfoodfacts_raw);

create index if not exists products_enrichment_sources_gin_idx
on public.products using gin (enrichment_sources);
