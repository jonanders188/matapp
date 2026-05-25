-- Matmakt patch 037
-- Re-invitasjoner etter at et medlem er fjernet skal bruke ny invitasjonsrad/token.
-- Denne patchen rydder duplikater og sikrer indeksene som API-et forventer.

update public.household_invitations
set email = lower(trim(email))
where email is not null;

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

create index if not exists household_invitations_email_status_idx
on public.household_invitations (lower(email), status, expires_at desc);
