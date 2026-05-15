-- Husholdningspilot patch 005: smart handleliste

create table if not exists shopping_lists (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid references households(id) on delete cascade,
  title text not null default 'Smart handleliste',
  status text not null default 'active' check (status in ('active','completed','archived')),
  max_stores integer not null default 2,
  estimated_total numeric(12,2) default 0,
  estimated_saving numeric(12,2) default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists shopping_list_items (
  id uuid primary key default uuid_generate_v4(),
  shopping_list_id uuid references shopping_lists(id) on delete cascade,
  household_id uuid references households(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  recommendation_id uuid references recommendations(id) on delete set null,
  product_name text not null,
  store_name text,
  quantity numeric not null default 1,
  estimated_price numeric(12,2),
  estimated_saving numeric(12,2),
  status text not null default 'planned' check (status in ('planned','purchased','skipped')),
  reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists shopping_lists_household_created_idx
  on shopping_lists(household_id, created_at desc);

create index if not exists shopping_list_items_list_idx
  on shopping_list_items(shopping_list_id);

create index if not exists shopping_list_items_household_status_idx
  on shopping_list_items(household_id, status);

alter table shopping_lists enable row level security;
alter table shopping_list_items enable row level security;
