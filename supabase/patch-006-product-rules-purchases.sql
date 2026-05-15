-- Patch 006: Produktregler og enkle kjøp/kvitteringer
-- Trygg å kjøre flere ganger.

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

alter table products add column if not exists target_price_unit text default 'unit';
alter table products add column if not exists desired_stock numeric default 0;
alter table products add column if not exists is_basis boolean default false;
alter table products add column if not exists is_freezable boolean default false;
alter table products add column if not exists preferred_store text;
alter table products add column if not exists notes text;

create index if not exists purchases_household_purchased_idx on purchases(household_id, purchased_at desc);
create index if not exists purchase_items_purchase_idx on purchase_items(purchase_id);
create index if not exists purchase_items_product_idx on purchase_items(product_id);
create index if not exists products_household_category_idx on products(household_id, category);
