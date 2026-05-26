-- Matmakt patch 049
-- Atomisk auto-oppretting av brukerens forste husholdning.
--
-- Hvorfor:
-- /api/me/access er read-only, men AppShell kan fortsatt trigge
-- /api/onboarding/ensure-household ved forste innlogging. Hvis to POST-kall
-- skjer parallelt, ma DB-funksjonen garantere at samme bruker ikke far to
-- default-husholdninger.

create or replace function public.ensure_user_household(
  p_user_id uuid,
  p_email text,
  p_display_name text default null
)
returns table (
  household_id uuid,
  household_name text,
  role text,
  created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership record;
  v_household record;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_display_name text := nullif(trim(coalesce(p_display_name, '')), '');
  v_household_name text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  -- Serialiser forstegangsoppretting per bruker uten a lase andre brukere.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select hm.household_id, hm.role, h.name
    into v_membership
  from public.household_members hm
  join public.households h on h.id = hm.household_id
  where hm.user_id = p_user_id
  order by hm.created_at asc nulls last
  limit 1;

  if found then
    household_id := v_membership.household_id;
    household_name := v_membership.name;
    role := coalesce(v_membership.role, 'member');
    created := false;
    return next;
    return;
  end if;

  v_household_name := case
    when v_email <> '' then v_email || ' Home'
    else 'Hjemme'
  end;

  if v_display_name is null then
    v_display_name := case
      when v_email <> '' then nullif(trim(regexp_replace(split_part(v_email, '@', 1), '[._-]+', ' ', 'g')), '')
      else null
    end;
  end if;

  if v_display_name is null then
    v_display_name := 'Eier';
  end if;

  insert into public.households (name, monthly_budget)
  values (v_household_name, 0)
  returning id, name into v_household;

  insert into public.household_members (household_id, user_id, display_name, role)
  values (v_household.id, p_user_id, v_display_name, 'admin');

  household_id := v_household.id;
  household_name := v_household.name;
  role := 'admin';
  created := true;
  return next;
end;
$$;

grant execute on function public.ensure_user_household(uuid, text, text) to service_role;
