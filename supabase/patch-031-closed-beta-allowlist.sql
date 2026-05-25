-- Matmakt patch 031: closed beta allowlist
-- Run this in Supabase SQL Editor before enabling MATMAKT_BETA_CLOSED=true in Vercel.

create table if not exists public.beta_allowed_emails (
  email text primary key,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.beta_waitlist_emails (
  email text primary key,
  source text,
  created_at timestamptz not null default now()
);

-- Add yourself and early testers here before closing beta.
-- insert into public.beta_allowed_emails (email, note)
-- values ('din@epost.no', 'founder')
-- on conflict (email) do update set note = excluded.note;

alter table public.beta_allowed_emails enable row level security;
alter table public.beta_waitlist_emails enable row level security;

-- Keep lists private for normal authenticated users. Service-role API routes can read/write.
drop policy if exists "No public beta allowlist access" on public.beta_allowed_emails;
create policy "No public beta allowlist access"
on public.beta_allowed_emails for all
using (false)
with check (false);

drop policy if exists "No public beta waitlist access" on public.beta_waitlist_emails;
create policy "No public beta waitlist access"
on public.beta_waitlist_emails for all
using (false)
with check (false);
