-- patch-020-system-admin-product-groups.sql
-- Adds global System Admin access and product grouping tables.
-- Safe to rerun.

begin;

create table if not exists public.system_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

insert into public.system_admins (user_id, email)
select id, email
from auth.users
where email = 'jon@aas-haug.no'
on conflict (user_id) do update
set email = excluded.email;

create table if not exists public.product_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  category text,
  comparison_unit text,
  description text,
  status text not null default 'active',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_groups_status_check check (status in ('active', 'archived'))
);

create table if not exists public.product_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.product_groups(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  relationship_type text not null,
  confidence numeric,
  reason text,
  source text not null default 'manual',
  manually_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint product_group_members_relationship_check check (
    relationship_type in (
      'same_product_different_package',
      'same_product_variant',
      'same_category_alternative',
      'not_comparable'
    )
  ),
  constraint product_group_members_source_check check (source in ('manual', 'ai_suggestion', 'import')),
  unique(group_id, product_id)
);

create table if not exists public.product_group_suggestions (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending',
  suggested_group_name text not null,
  brand text,
  category text,
  comparison_unit text,
  confidence numeric,
  reason text,
  raw jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  constraint product_group_suggestions_status_check check (status in ('pending', 'approved', 'rejected'))
);

create table if not exists public.product_group_suggestion_members (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.product_group_suggestions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  relationship_type text not null,
  confidence numeric,
  reason text,
  created_at timestamptz not null default now(),
  constraint product_group_suggestion_members_relationship_check check (
    relationship_type in (
      'same_product_different_package',
      'same_product_variant',
      'same_category_alternative',
      'not_comparable'
    )
  ),
  unique(suggestion_id, product_id)
);

create index if not exists idx_product_groups_status
  on public.product_groups(status, name);

create index if not exists idx_product_group_members_product
  on public.product_group_members(product_id);

create index if not exists idx_product_group_members_group
  on public.product_group_members(group_id);

create index if not exists idx_product_group_suggestions_status
  on public.product_group_suggestions(status, created_at desc);

create index if not exists idx_product_group_suggestion_members_product
  on public.product_group_suggestion_members(product_id);

commit;
