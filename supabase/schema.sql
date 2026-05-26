-- Husholdningspilot MVP schema
-- Kjor denne i Supabase SQL editor.

create extension if not exists "uuid-ossp";

create table if not exists households (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  monthly_budget numeric(12,2) default 0,
  created_at timestamptz default now()
);

create table if not exists household_members (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid references households(id) on delete cascade,
  user_id uuid,
  display_name text not null,
  role text default 'member',
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid references households(id) on delete cascade,
  kassalapp_id bigint,
  ean text,
  name text not null,
  brand text,
  category text,
  category_path text[],
  package_size text,
  image_url text,
  description text,
  ingredients text,
  allergens jsonb,
  nutrition jsonb,
  labels jsonb,
  kassalapp_raw jsonb,
  target_price numeric(12,2),
  target_price_unit text default 'unit',
  desired_stock numeric default 0,
  is_basis boolean default false,
  is_freezable boolean default false,
  preferred_store text,
  notes text,
  created_at timestamptz default now(),
  unique(household_id, ean)
);

create table if not exists price_observations (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade,
  store_code text not null,
  store_name text not null,
  price numeric(12,2) not null,
  unit_price numeric(12,2),
  observed_at timestamptz not null default now(),
  source text default 'kassalapp',
  source_url text,
  raw jsonb,
  valid_from timestamptz,
  valid_until timestamptz,
  price_type text not null default 'regular',
  is_campaign boolean not null default false,
  campaign_label text,
  confidence text not null default 'high',
  exclude_from_analysis boolean not null default false
);

create table if not exists purchases (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid references households(id) on delete cascade,
  store_name text not null,
  receipt_no text,
  purchased_at timestamptz not null,
  total_amount numeric(12,2),
  trumf_bonus numeric(12,2),
  source text default 'manual',
  created_at timestamptz default now()
);

create table if not exists purchase_items (
  id uuid primary key default uuid_generate_v4(),
  purchase_id uuid references purchases(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  raw_name text not null,
  quantity numeric default 1,
  unit text default 'stk',
  paid_price numeric(12,2) not null,
  discount numeric(12,2) default 0,
  trumf_percent numeric(5,2),
  created_at timestamptz default now()
);

create table if not exists inventory_items (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid references households(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  location text not null default 'Kjokken',
  quantity numeric not null default 0,
  desired_quantity numeric not null default 0,
  expires_at date,
  updated_at timestamptz default now(),
  unique(household_id, product_id, location)
);

create table if not exists freezer_items (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid references households(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  name text not null,
  quantity numeric default 1,
  frozen_at date,
  best_before date,
  portions numeric default 1,
  status text default 'ok',
  created_at timestamptz default now()
);

create table if not exists recommendations (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid references households(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  action text not null check (action in ('buy','wait','stock_up','use_up','switch_brand')),
  store_name text,
  price numeric(12,2),
  estimated_saving numeric(12,2),
  reason text not null,
  valid_until timestamptz,
  created_at timestamptz default now()
);

alter table households enable row level security;
alter table household_members enable row level security;
alter table products enable row level security;
alter table price_observations enable row level security;
alter table purchases enable row level security;
alter table purchase_items enable row level security;
alter table inventory_items enable row level security;
alter table freezer_items enable row level security;
alter table recommendations enable row level security;


-- Patch 001: API/integrasjon-stotte
create unique index if not exists products_household_kassalapp_id_idx
  on products(household_id, kassalapp_id)
  where kassalapp_id is not null;

create index if not exists price_observations_product_observed_idx
  on price_observations(product_id, observed_at desc);

create index if not exists products_household_created_idx
  on products(household_id, created_at desc);
