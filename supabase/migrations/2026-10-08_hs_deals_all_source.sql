-- Quay Leads — "All Leads" bank: source + creator attribution on hs_deals_all.
--
-- The All Leads view is the company-wide bank of every deal created in HubSpot,
-- split by the three input channels the business thinks in:
--   • dialfire — cold-calling dialer, auto-created via the n8n pipe (INTEGRATION)
--   • slb      — Seller Lead Bank inbound (lead sits on the Leads sheet)
--   • team     — a broker manually created the deal in the CRM (CRM_UI)
--
-- hs_deals_all already carries owner-based `team`. These columns add:
--   • source_label       — raw HubSpot hs_object_source_label (INTEGRATION/CRM_UI/…)
--   • created_by_user_id — HubSpot hs_created_by_user_id (the CREATOR, not owner)
--   • created_by_team    — creator resolved to a team (owner→team vote), for the
--                          team-created channel which the owner can't attribute
--   • source             — resolved channel: 'dialfire' | 'slb' | 'team' | 'other'
--
-- "Worked lead" and "rental" are NOT stored — they're derived from stage_label
-- in the view (Contacted - Lead to Nurture; Rental Lead / Referred to Rentals),
-- so the definitions stay in one place (stages.js) and never drift from a column.

alter table public.hs_deals_all add column if not exists source_label       text;
alter table public.hs_deals_all add column if not exists created_by_user_id text;
alter table public.hs_deals_all add column if not exists created_by_team    text;
alter table public.hs_deals_all add column if not exists source             text;

create index if not exists hs_deals_all_source_idx on public.hs_deals_all (source);

comment on column public.hs_deals_all.source is
  'Resolved input channel: dialfire (INTEGRATION, cold-call pipe), slb (on the Seller Lead Bank sheet), team (CRM_UI, broker-created), or other. Set by scripts/sync.py.';
comment on column public.hs_deals_all.created_by_team is
  'hs_created_by_user_id resolved to a team via the same owner->team vote as owner_team_for; used to attribute team-created (CRM_UI) deals by their creator.';
