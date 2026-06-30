-- Quay 1 Seller Leads — Pages edition
-- =================================================================
-- Two new tables synced every 30 min by .github/workflows/sync.yml:
--
--   leads          — mirror of the Quay 1 Seller Lead Bank sheet
--                    (one row per email, latest wins on duplicates)
--   hs_deal_state  — per-HubSpot-deal current stage + call count,
--                    keyed by deal_id (extracted from HubspotStatus2)
--
-- RLS: only authenticated super/admin staff (same gate as lead_actions)
-- can SELECT. Writes go through the service-role key, used only by the
-- GitHub Action (never the browser).

create table if not exists public.leads (
  email          text primary key,                 -- lowercased
  datestamp      timestamptz,
  source         text,
  client_name    text,
  phone          text,
  property_address text,
  suburb         text,
  property_type  text,
  division       text,
  hubspot_div_id text,
  is_lead        text,
  timeline       text,
  relationship   text,
  hubspot_status text,
  hubspot_status2 text,
  deal_id        text,                             -- parsed from hubspot_status2
  updated_at     timestamptz not null default now()
);

create index if not exists leads_datestamp_idx on public.leads (datestamp desc);
create index if not exists leads_division_idx  on public.leads (division);
create index if not exists leads_source_idx    on public.leads (source);
create index if not exists leads_deal_id_idx   on public.leads (deal_id);

create table if not exists public.hs_deal_state (
  deal_id          text primary key,
  current_stage_id text,
  current_stage    text,
  deal_name        text,
  amount           numeric,
  close_date       timestamptz,
  hs_last_modified timestamptz,
  hubspot_owner_id text,
  pipeline         text,
  probability      numeric,
  num_calls        integer not null default 0,
  worked           boolean generated always as (num_calls > 0) stored,
  refreshed_at     timestamptz not null default now()
);

create index if not exists hs_deal_state_stage_idx    on public.hs_deal_state (current_stage);
create index if not exists hs_deal_state_worked_idx   on public.hs_deal_state (worked);

create table if not exists public.sync_status (
  name            text primary key,
  last_synced_at  timestamptz,
  ok              boolean,
  message         text
);

-- RLS — same gate as lead_actions: super/admin staff only
alter table public.leads          enable row level security;
alter table public.hs_deal_state  enable row level security;
alter table public.sync_status    enable row level security;

drop policy if exists "leads: super/admin select"         on public.leads;
create policy "leads: super/admin select"
  on public.leads for select to authenticated
  using (exists (select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and (s.is_super = true or s.is_admin = true)
      and coalesce(s.active, true) = true));

drop policy if exists "hs_deal_state: super/admin select" on public.hs_deal_state;
create policy "hs_deal_state: super/admin select"
  on public.hs_deal_state for select to authenticated
  using (exists (select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and (s.is_super = true or s.is_admin = true)
      and coalesce(s.active, true) = true));

drop policy if exists "sync_status: authenticated select" on public.sync_status;
create policy "sync_status: authenticated select"
  on public.sync_status for select to authenticated using (true);

comment on table public.leads is
  'Mirror of the Quay 1 Seller Lead Bank Google Sheet. Synced every 30 min by Twigs002/quay-leads GitHub Action. Source sheet is read-only per project rules.';
comment on table public.hs_deal_state is
  'Per-HubSpot-deal current state. Synced alongside leads. worked = num_calls > 0.';
