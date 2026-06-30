-- View: leads_enriched
-- =================================================================
-- Pre-joins everything the browser dashboard needs into a single
-- result row per lead, so first-paint is ONE paginated query per
-- table-tab instead of the previous 12+ round-trip dance.
--
-- Joins:
--   leads             — base
--   hs_deal_state     — live HubSpot enrichment, by deal_id
--   lead_actions      — latest note per email
--
-- RLS: inherits from underlying tables (super/admin only).

create or replace view public.leads_enriched as
with latest_actions as (
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
left join latest_actions a       on a.email_lc = lower(l.email);

comment on view public.leads_enriched is
  'Browser-facing single-query view. Joins leads + hs_deal_state + latest lead_action per email. RLS inherited from underlying tables.';
