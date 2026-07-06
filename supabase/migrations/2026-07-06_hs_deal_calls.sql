-- Quay 1 Seller Leads — per-deal call history
-- =================================================================
-- One row per HubSpot call engagement, keyed by (deal_id, call_id).
-- Populated by scripts/sync.py from HubSpot's calls endpoint after
-- the existing associations lookup already told us which call IDs
-- belong to which deal.
--
-- Why (deal_id, call_id) instead of just call_id: HubSpot allows a
-- single call to be associated with multiple deals (rare — usually
-- when a caller mentions two properties). Keying on the pair lets us
-- show the call under each deal without deduping in the browser.
--
-- Feeds the Track tab's expandable call-history row. `agent_name`
-- comes from a client-side lookup against staff / owner map — the
-- API only gives us hubspot_owner_id, which we store here as-is.
--
-- RLS: same super/admin gate as hs_deal_state. Team members reach
-- these rows via the leads_enriched-scoped read path (see next
-- migration).

create table if not exists public.hs_deal_calls (
  deal_id          text        not null,
  call_id          text        not null,
  ts               timestamptz,                          -- hs_timestamp
  direction        text,                                 -- INBOUND / OUTBOUND / null
  disposition      text,                                 -- HubSpot disposition ID or label
  hubspot_owner_id text,                                 -- who logged it
  duration_sec     integer,                              -- hs_call_duration / 1000
  notes            text,                                 -- hs_call_body (HTML stripped)
  refreshed_at     timestamptz not null default now(),
  primary key (deal_id, call_id)
);

create index if not exists hs_deal_calls_deal_id_idx
  on public.hs_deal_calls (deal_id);
create index if not exists hs_deal_calls_ts_idx
  on public.hs_deal_calls (ts desc);
create index if not exists hs_deal_calls_owner_idx
  on public.hs_deal_calls (hubspot_owner_id);

alter table public.hs_deal_calls enable row level security;

-- Base gate: super/admin can read every row directly. Team-scoped
-- reads happen via the RPC below (bypasses base RLS with a division
-- match, same pattern as leads_enriched).
drop policy if exists "hs_deal_calls: super/admin select" on public.hs_deal_calls;
create policy "hs_deal_calls: super/admin select"
  on public.hs_deal_calls for select to authenticated
  using (
    exists (
      select 1 from public.staff s
      where s.auth_user_id = auth.uid()
        and (s.is_super = true or s.is_admin = true)
        and coalesce(s.active, true) = true
    )
  );

-- Team members: can read call rows for deals whose lead-row division
-- matches theirs, OR whose HubSpot owner belongs to their team. Same
-- two-headed match as leads_enriched.
drop policy if exists "hs_deal_calls: team select" on public.hs_deal_calls;
create policy "hs_deal_calls: team select"
  on public.hs_deal_calls for select to authenticated
  using (
    exists (
      select 1
      from public.leads l
      left join public.hs_deal_state d on d.deal_id = l.deal_id
      join public.staff s on s.auth_user_id = auth.uid()
      where l.deal_id = hs_deal_calls.deal_id
        and coalesce(s.active, true) = true
        and s.division is not null
        and s.division <> ''
        and (
          lower(trim(coalesce(l.division, ''))) = lower(trim(s.division))
          or (d.hubspot_owner_id is not null
              and public.owner_team_for(d.hubspot_owner_id) = lower(trim(s.division)))
        )
    )
  );

comment on table public.hs_deal_calls is
  'One row per HubSpot call engagement, per associated deal. Populated by scripts/sync.py. Feeds the Track tab per-lead call history.';
