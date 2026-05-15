-- Patch 007: Produktalternativer og billigmerker
-- Trygg aa kjore flere ganger.

create table if not exists product_alternatives (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid references households(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  alternative_name text not null,
  alternative_brand text,
  alternative_ean text,
  alternative_kassalapp_id bigint,
  alternative_image_url text,
  alternative_store_name text,
  alternative_store_code text,
  alternative_price numeric(12,2),
  alternative_unit_price numeric(12,2),
  alternative_source_url text,
  match_type text default 'rule',
  confidence numeric(5,2) default 0,
  estimated_saving numeric(12,2),
  status text not null default 'candidate' check (status in ('candidate', 'testing', 'accepted', 'rejected')),
  reason text,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table product_alternatives add column if not exists household_id uuid references households(id) on delete cascade;
alter table product_alternatives add column if not exists product_id uuid references products(id) on delete cascade;
alter table product_alternatives add column if not exists alternative_name text;
alter table product_alternatives add column if not exists alternative_brand text;
alter table product_alternatives add column if not exists alternative_ean text;
alter table product_alternatives add column if not exists alternative_kassalapp_id bigint;
alter table product_alternatives add column if not exists alternative_image_url text;
alter table product_alternatives add column if not exists alternative_store_name text;
alter table product_alternatives add column if not exists alternative_store_code text;
alter table product_alternatives add column if not exists alternative_price numeric(12,2);
alter table product_alternatives add column if not exists alternative_unit_price numeric(12,2);
alter table product_alternatives add column if not exists alternative_source_url text;
alter table product_alternatives add column if not exists match_type text default 'rule';
alter table product_alternatives add column if not exists confidence numeric(5,2) default 0;
alter table product_alternatives add column if not exists estimated_saving numeric(12,2);
alter table product_alternatives add column if not exists status text not null default 'candidate';
alter table product_alternatives add column if not exists reason text;
alter table product_alternatives add column if not exists raw jsonb;
alter table product_alternatives add column if not exists created_at timestamptz default now();
alter table product_alternatives add column if not exists updated_at timestamptz default now();

create index if not exists product_alternatives_household_status_idx
  on product_alternatives(household_id, status, created_at desc);

create index if not exists product_alternatives_product_idx
  on product_alternatives(product_id, created_at desc);

create unique index if not exists product_alternatives_product_ean_unique
  on product_alternatives(product_id, alternative_ean)
  where alternative_ean is not null;

create unique index if not exists product_alternatives_product_kassalapp_unique
  on product_alternatives(product_id, alternative_kassalapp_id)
  where alternative_kassalapp_id is not null;

alter table product_alternatives enable row level security;
