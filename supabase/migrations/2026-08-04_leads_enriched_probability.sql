-- Quay Leads — deal-stage probability + farming-area enrichment
-- =================================================================
-- Two additions to the browser view, in ONE authoritative redefinition so
-- migration ordering can never drop a column:
--   1. probability — HubSpot hs_deal_stage_probability (0..1), already
--      synced but never surfaced. Feeds the Pipeline "% amount" per stage.
--   2. farming area — a suburb→area map (the "division area breakdown").
--      A lead whose suburb isn't in our farmed set is OUT OF AREA and
--      counts as an "unqualified lead". While farming_areas is empty the
--      join yields null and every lead is treated as in-area (unknown), so
--      behaviour is unchanged until the sheet is loaded.
--
-- Everything else matches 2026-07-02_leads_enriched_team_scope.sql
-- (security_invoker=off + caller-scoped filter).

-- ── Farming-area map: which suburbs we farm (the DAB) ────────────────────
create table if not exists public.farming_areas (
  suburb_lc         text primary key,      -- lower(trim(suburb)) — the join key
  suburb            text,                  -- original casing for display
  area              text,                  -- farming area / team the suburb belongs to
  open_border_group text,                  -- WSB | NS | SP | SW (optional)
  in_farming        boolean not null default true,  -- false = explicitly NOT farmed
  updated_at        timestamptz not null default now()
);

comment on table public.farming_areas is
  'Suburb -> farming area (DAB) map, ingested from the division-area breakdown sheet by scripts/farming_sync.py. A lead whose suburb_lc is absent here (once populated) is out of our farming area / unqualified.';

alter table public.farming_areas enable row level security;
drop policy if exists "farming_areas: authenticated read" on public.farming_areas;
create policy "farming_areas: authenticated read"
  on public.farming_areas for select to authenticated
  using (exists (select 1 from public.staff s
    where s.auth_user_id = auth.uid() and coalesce(s.active, true) = true));

-- ── Redefine the browser view ────────────────────────────────────────────
drop view if exists public.leads_enriched;

create view public.leads_enriched
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
  d.probability,
  coalesce(d.num_calls, 0)                                 as num_calls,
  coalesce(d.worked, false)                                as worked,
  fa.area                                                  as farming_area,
  -- Out-of-area logic. The DAB sheet lists the suburbs we DO farm, so a
  -- suburb ABSENT from a populated map is out of area:
  --   suburb in map      -> fa.in_farming (normally true)
  --   suburb absent, map has rows  -> false (out of area / unqualified)
  --   map empty (not loaded yet)   -> null  (unknown; client treats as in-area)
  -- The subquery is uncorrelated so Postgres evaluates it once per query.
  case
    when fa.suburb_lc is not null then fa.in_farming
    when exists (select 1 from public.farming_areas) then false
    else null
  end                                                      as in_farming_area,
  a.action_note,
  a.note_by,
  a.note_at
from public.leads l
left join public.hs_deal_state d on d.deal_id = l.deal_id
left join public.farming_areas fa on fa.suburb_lc = lower(trim(coalesce(l.suburb, '')))
left join latest_actions a       on a.email_lc = lower(l.email)
where exists (
  select 1 from caller c
  where c.active
    and (
      c.is_super
      or c.is_admin
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
  'Scoped browser view: super/admin see all, team members see their division. Adds probability (HubSpot win %) and farming_area/in_farming_area (out-of-area = unqualified). Runs as owner (security_invoker off).';
