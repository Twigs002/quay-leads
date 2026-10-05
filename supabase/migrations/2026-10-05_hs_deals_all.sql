-- Quay Leads — whole-book HubSpot deal register (true "Deals created")
--
-- The dashboard's leads_enriched is lead-sheet-driven (one row per captured
-- email, left-joined to its deal), so it structurally undercounts HubSpot deals:
-- any deal never written back onto a Seller-Lead-Bank sheet row is invisible,
-- and repeat-email sellers collapse to one row. That is why "deals" on the
-- dashboard read far below HubSpot (e.g. 42 vs 126 for a team over 12 months).
--
-- This table holds the WHOLE default sales pipeline (last ~12 months by deal
-- createdate), independent of the lead sheet, so the COO view can show a true
-- "Deals created (HubSpot)" count per team + period that reconciles with HubSpot.
-- `team` is resolved at write time by scripts/sync.py via the same owner→team
-- vote as owner_team_for (lowercased). Written by the service role; super/admin
-- read only (no client PII in this table).

create table if not exists public.hs_deals_all (
  deal_id          text primary key,
  pipeline         text,
  dealstage        text,
  stage_label      text,
  amount           numeric,
  hubspot_owner_id text,
  team             text,          -- lowercased owner→team vote, null if unknown
  createdate       timestamptz,
  close_date       timestamptz,
  is_closed        boolean     not null default false,
  refreshed_at     timestamptz not null default now()
);

create index if not exists hs_deals_all_createdate_idx on public.hs_deals_all (createdate desc);
create index if not exists hs_deals_all_team_idx       on public.hs_deals_all (team);

alter table public.hs_deals_all enable row level security;

-- Super/admin read only. All writes go through the service role (bypasses RLS).
drop policy if exists "hs_deals_all: super/admin select" on public.hs_deals_all;
create policy "hs_deals_all: super/admin select"
  on public.hs_deals_all for select to authenticated
  using (exists (select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and (s.is_super = true or s.is_admin = true)
      and coalesce(s.active, true) = true));

grant select on public.hs_deals_all to authenticated;

comment on table public.hs_deals_all is
  'Whole default-pipeline HubSpot deal book (last ~12 months by createdate), independent of the lead sheet. Written by sync.py service role; super/admin read only. Feeds the true "Deals created (HubSpot)" per-team reconciliation metric. team = lowercased owner->team vote (same as owner_team_for).';
