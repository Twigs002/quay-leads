-- Quay Leads — deal creation source (Option B: auto-created vs manual)
-- =================================================================
-- Surface HOW each HubSpot deal was created so the dashboard can split
-- auto-created deals (the Dialfire -> n8n pipe, which reads
-- hs_object_source_label = INTEGRATION, detail_1 = n8n.cloud) from
-- manually-created ones (CRM_UI). HubSpot has no "Dialfire" marker — the
-- automation stamps n8n as the record source — so n8n is our proxy for the
-- automated pipe until n8n writes a dedicated lead_source property.
--
-- Two nullable columns on hs_deal_state (backfilled by the next sync run,
-- which now pulls hs_object_source_label + hs_object_source_detail_1), then
-- one authoritative redefinition of leads_enriched that exposes them. Matches
-- 2026-08-04_leads_enriched_probability.sql (security_invoker off + caller
-- scope) with the two new columns added.

-- ── Extra hs_deal_state columns (nullable → no backfill needed) ───────────
alter table public.hs_deal_state
  add column if not exists hs_object_source        text,   -- CRM_UI | INTEGRATION | IMPORT | ...
  add column if not exists hs_object_source_detail text;   -- e.g. n8n.cloud for the auto pipe

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
  d.hs_object_source                                       as deal_source,
  d.hs_object_source_detail                                as deal_source_detail,
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
  'Scoped browser view: super/admin see all, team members see their division. Adds probability, farming_area/in_farming_area, and deal_source/deal_source_detail (how the deal was created; n8n.cloud = the auto Dialfire pipe). Runs as owner (security_invoker off).';
