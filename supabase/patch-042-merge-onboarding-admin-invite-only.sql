-- Household invitations: explicit acceptance flow.
-- Run this in Supabase SQL editor before testing invitation from Admin.

create table if not exists public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'member' check (role in ('admin', 'member', 'child')),
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  invited_by_user_id uuid,
  accepted_by_user_id uuid,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

update public.household_invitations
set email = lower(trim(email))
where email is not null;

create unique index if not exists household_invitations_token_idx
on public.household_invitations (token);

create unique index if not exists household_invitations_household_id_email_key
on public.household_invitations (household_id, email);

create index if not exists household_invitations_email_status_idx
on public.household_invitations (lower(email), status, expires_at desc);

create unique index if not exists household_members_household_user_key
on public.household_members (household_id, user_id);
