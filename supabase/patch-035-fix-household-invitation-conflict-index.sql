-- Matmakt patch 035
-- Fix for household invite upsert error:
-- 42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- The app uses ON CONFLICT (household_id, email). PostgreSQL requires a matching
-- plain unique constraint/index. The previous patch used lower(email), which does
-- not match ON CONFLICT (household_id, email).

-- Normalize stored emails before adding the plain unique index.
update public.household_invitations
set email = lower(trim(email))
where email is not null
  and email <> lower(trim(email));

-- If duplicates exist for the same household/email, keep the newest invite.
with ranked as (
  select
    id,
    row_number() over (
      partition by household_id, email
      order by created_at desc nulls last, id desc
    ) as rn
  from public.household_invitations
)
delete from public.household_invitations hi
using ranked r
where hi.id = r.id
  and r.rn > 1;

-- This is the index that matches Supabase upsert onConflict: "household_id,email".
create unique index if not exists household_invitations_household_email_idx
  on public.household_invitations (household_id, email);

-- Keep the lower(email) lookup index as a non-unique helper if it already exists/needed.
create index if not exists household_invitations_lower_email_status_idx
  on public.household_invitations (lower(email), status, expires_at desc);

-- Closed beta allowlist is also used with ON CONFLICT (email). Ensure that works too.
-- This is safe if the table exists from patch 031.
do $$
begin
  if to_regclass('public.beta_allowed_emails') is not null then
    update public.beta_allowed_emails
    set email = lower(trim(email))
    where email is not null
      and email <> lower(trim(email));

    delete from public.beta_allowed_emails a
    using public.beta_allowed_emails b
    where a.ctid < b.ctid
      and a.email = b.email;

    create unique index if not exists beta_allowed_emails_email_unique_idx
      on public.beta_allowed_emails (email);
  end if;
end $$;
