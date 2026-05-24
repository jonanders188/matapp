-- patch-023-product-group-targeted-search-and-member-removal.sql
-- Adds helper table if missing. Safe to rerun.

begin;

create table if not exists public.product_group_negative_matches (
  id uuid primary key default gen_random_uuid(),
  product_id_a uuid not null references public.products(id) on delete cascade,
  product_id_b uuid not null references public.products(id) on delete cascade,
  reason text,
  source text not null default 'system_admin_rejected',
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_group_negative_matches_pair_order check (product_id_a < product_id_b),
  constraint product_group_negative_matches_source_check check (
    source in ('system_admin_rejected', 'system_admin_removed_member', 'manual_cleanup')
  ),
  unique(product_id_a, product_id_b)
);

create index if not exists idx_product_group_negative_matches_active_a
  on public.product_group_negative_matches(product_id_a)
  where is_active = true;

create index if not exists idx_product_group_negative_matches_active_b
  on public.product_group_negative_matches(product_id_b)
  where is_active = true;

commit;
