-- Quay Leads — team-member scoped read
-- =================================================================
-- Unlocks the original quay-leads handoff goal #1: "give each team
-- direct access to see their own numbers via RLS-scoped views by
-- staff.division."
--
-- Approach:
--   1. Keep base-table RLS on `leads` and `hs_deal_state` restricted
--      to super/admin (no change) — nobody hits them directly.
--   2. Redefine `leads_enriched` to run as its OWNER (security_invoker
--      off) so it can bypass base-table RLS, but filter INTERNALLY
--      by the caller's identity via auth.uid():
--        - super/admin: sees all rows
--        - anyone else with a matching staff row: sees rows where
--          the sheet division matches their staff.division
--          (case-insensitive, trimmed) OR the deal owner's inferred
--          team matches
--        - unmatched caller: sees zero rows
--   3. Grant SELECT on leads_enriched to authenticated (view is safe
--      by construction — filter runs before rows leave).
--
-- Same idempotency + safety pattern as team_activity_daily's
-- multi-level policy set.

-- Helper: owner_id → team map materialised at query time from the
-- leads sheet's (hubspot_div_id, division) pairs. Same logic as
-- scripts/team_activity_sync.py's Python-side vote. Not cached — the
-- planner inlines it and it runs fast enough for a per-request check.
create or replace function public.owner_team_for(owner_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(division))
  from public.leads
  where hubspot_div_id = owner_id
    and division is not null
    and division <> ''
    and upper(division) <> 'UPDATED BELOW'
  group by lower(trim(division))
  order by count(*) desc
  limit 1
$$;

comment on function public.owner_team_for(text) is
  'Vote-based owner_id → team name. Used by leads_enriched RLS so a lead assigned to a HubSpot owner surfaces for that owner''s team members even when the sheet division is stale.';

create or replace view public.leads_enriched
with (security_invoker = off) as
with caller as (
  select id,
         lower(trim(coalesce(division, ''))) as division_lc,
         coalesce(is_super, false) as is_super,
         coalesce(is_admin, false) as is_admin,
         coalesce(active, true) as active
  from public.staff
  where auth_user_id = auth.uid()
  limit 1
),
latest_actions as (
  select distinct on (lower(email))
    lower(email) as email_lc,
    note         as action_note,
    actioned_by  as note_by,
    actioned_at  as note_at
  from public.lead_actions
  order by lower(email), actioned_at desc
)
select
  l.email,
  l.datestamp,
  l.source,
  l.client_name,
  l.phone,
  l.property_address,
  l.suburb,
  l.property_type,
  l.division,
  l.hubspot_div_id,
  l.is_lead,
  l.timeline,
  l.relationship,
  l.hubspot_status,
  l.hubspot_status2,
  l.deal_id,
  (l.deal_id is not null)                                  as has_deal,
  case when l.deal_id is not null
       then 'Has Deal' else 'Retry / Action Needed' end    as action_flag,
  d.current_stage,
  d.deal_name,
  d.amount,
  d.close_date,
  d.hs_last_modified,
  d.hubspot_owner_id,
  coalesce(d.num_calls, 0)                                 as num_calls,
  coalesce(d.worked, false)                                as worked,
  a.action_note,
  a.note_by,
  a.note_at
from public.leads l
left join public.hs_deal_state d on d.deal_id = l.deal_id
left join latest_actions a       on a.email_lc = lower(l.email)
where exists (
  select 1 from caller c
  where c.active
    and (
      c.is_super
      or c.is_admin
      -- Team-member scope: match on sheet division OR the deal
      -- owner's inferred team (in case the sheet division is stale
      -- but the deal was reassigned in HubSpot).
      or (
        c.division_lc <> ''
        and (
          lower(trim(coalesce(l.division, ''))) = c.division_lc
          or (d.hubspot_owner_id is not null
              and public.owner_team_for(d.hubspot_owner_id) = c.division_lc)
        )
      )
    )
);

grant select on public.leads_enriched to authenticated;

comment on view public.leads_enriched is
  'Scoped browser-facing view: super/admin see all leads, team members see rows matching their staff.division (either the sheet division or the deal owner''s inferred team). Runs as owner (security_invoker off) so it bypasses base-table RLS — those tables stay locked down to super/admin.';

-- team_activity_daily already has team-scoped RLS from the original
-- migration — no change needed here.

-- lead_actions: allow team members to write notes on their team's leads.
drop policy if exists "lead_actions team write" on public.lead_actions;
create policy "lead_actions team write"
  on public.lead_actions for insert to authenticated
  with check (
    exists (
      select 1 from public.staff s
      join public.leads l on lower(trim(coalesce(l.division, ''))) = lower(trim(coalesce(s.division, '')))
      where s.auth_user_id = auth.uid()
        and coalesce(s.active, true) = true
        and s.division is not null
        and s.division <> ''
        and lower(l.email) = lower(email)
    )
    or exists (
      select 1 from public.staff s
      where s.auth_user_id = auth.uid()
        and (s.is_super or s.is_admin)
    )
  );
