-- Matmakt patch 036: real household invitations that must be accepted by recipient.

create extension if not exists pgcrypto;

create table if not exists public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'member',
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  status text not null default 'pending',
  invited_by_user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.household_invitations add column if not exists display_name text;
alter table public.household_invitations add column if not exists role text not null default 'member';
alter table public.household_invitations add column if not exists invited_by_user_id uuid references auth.users(id) on delete set null;
alter table public.household_invitations add column if not exists accepted_at timestamptz;
alter table public.household_invitations add column if not exists updated_at timestamptz not null default now();

update public.household_invitations
set email = lower(trim(email))
where email is not null and email <> lower(trim(email));

with ranked as (
  select
    id,
    row_number() over (
      partition by household_id, lower(email)
      order by created_at desc nulls last, id::text desc
    ) as rn
  from public.household_invitations
)
delete from public.household_invitations hi
using ranked r
where hi.id = r.id
  and r.rn > 1;

-- This exact index is required by ON CONFLICT (household_id, email).
create unique index if not exists household_invitations_household_id_email_key
on public.household_invitations (household_id, email);

create unique index if not exists household_invitations_token_key
on public.household_invitations (token);

create index if not exists household_invitations_email_status_idx
on public.household_invitations (lower(email), status, expires_at desc);

-- This exact index is required by member upsert in invitation acceptance.
create unique index if not exists household_members_household_id_user_id_key
on public.household_members (household_id, user_id);
