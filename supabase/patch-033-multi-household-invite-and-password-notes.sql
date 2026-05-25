-- patch-033-multi-household-invite-and-password-notes.sql
-- Documentation/guardrails for multi-household membership.
-- A user may be a member of several households. The app selects the active household
-- through the x-matmakt-household-id request header stored in browser localStorage.

create unique index if not exists household_members_household_user_unique
on public.household_members (household_id, user_id);

-- Helpful lookup for invite/member screens.
create index if not exists household_members_user_created_idx
on public.household_members (user_id, created_at);
