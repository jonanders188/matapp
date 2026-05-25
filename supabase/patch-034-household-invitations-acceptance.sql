-- Matmakt patch 034
-- Invitasjoner til husholdning skal godkjennes av mottaker før medlemskap opprettes.

create table if not exists public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'member',
  token text not null unique,
  status text not null default 'pending',
  invited_by uuid,
  accepted_user_id uuid,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  constraint household_invitations_role_check check (role in ('admin', 'member', 'child')),
  constraint household_invitations_status_check check (status in ('pending', 'accepted', 'revoked', 'expired'))
);

create unique index if not exists household_invitations_household_email_idx
  on public.household_invitations (household_id, lower(email));

create index if not exists household_invitations_token_idx
  on public.household_invitations (token);

create index if not exists household_invitations_email_status_idx
  on public.household_invitations (lower(email), status, expires_at desc);

-- Samme bruker kan være medlem av flere husholdninger, men ikke dobbelt i samme husholdning.
create unique index if not exists household_members_household_user_unique_idx
  on public.household_members (household_id, user_id);
