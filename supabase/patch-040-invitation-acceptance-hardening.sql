-- Matmakt patch 040: harden household invitation acceptance and re-invites.

create extension if not exists pgcrypto;

alter table public.household_invitations
  add column if not exists display_name text,
  add column if not exists role text not null default 'member',
  add column if not exists status text not null default 'pending',
  add column if not exists expires_at timestamptz not null default (now() + interval '14 days'),
  add column if not exists accepted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.household_invitations
set email = lower(trim(email))
where email is not null and email <> lower(trim(email));

-- Keep only newest invitation per household/email, because re-invites should produce one current token.
with ranked as (
  select
    id,
    row_number() over (
      partition by household_id, email
      order by created_at desc nulls last, id::text desc
    ) as rn
  from public.household_invitations
)
delete from public.household_invitations hi
using ranked r
where hi.id = r.id
  and r.rn > 1;

create unique index if not exists household_invitations_household_id_email_key
on public.household_invitations (household_id, email);

create unique index if not exists household_invitations_token_key
on public.household_invitations (token);

create unique index if not exists household_members_household_user_key
on public.household_members (household_id, user_id);

create index if not exists household_invitations_token_status_idx
on public.household_invitations (token, status, expires_at desc);
