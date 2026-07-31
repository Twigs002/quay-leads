-- Quay Leads — open-border lead reassignment (STAGE-INDEPENDENT SCAFFOLD)
-- =================================================================
-- Auto-reassign seller-lead deals that sit untouched in an early stage.
-- Rule (evaluator wired in a later migration once stage names are
-- confirmed): a deal in a qualifying stage (External / Inbound / Calling),
-- with 0 logged calls, whose 72h clock (from deal creation, and reset on
-- each hop) has elapsed, and whose current owner's team is in an
-- OPEN-BORDER group with can_originate on → reassign to a RANDOM other
-- team in the SAME group (can_receive on, active, has an owner id, not a
-- team that has already held this deal). Writes BOTH the deal owner and
-- every associated contact's owner in HubSpot.
--
-- This migration is INERT: it creates config + audit + the extra
-- hs_deal_state columns and seeds the team map. Nothing reads or writes
-- these until the evaluator ships. Safe to run now.

-- ── Extra hs_deal_state columns (all nullable / defaulted → no backfill) ──
alter table public.hs_deal_state
  add column if not exists hs_createdate      timestamptz,   -- 72h clock origin
  add column if not exists last_reassigned_at timestamptz,   -- clock resets here on each hop
  add column if not exists reassign_visited   text[]         -- owner ids that have held this deal (anti ping-pong)
                                              default '{}',
  add column if not exists reassign_hops      integer not null default 0;

-- ── Config: per-team open-border membership + on/off toggles ─────────────
create table if not exists public.reassignment_teams (
  team              text primary key,        -- display name, matches the division-area sheet
  open_border_group text not null,           -- WSB | NS | SP | SW
  hubspot_owner_id  text,                    -- null = can never receive (e.g. Fran)
  can_originate     boolean not null default true,   -- may LOSE stale leads
  can_receive       boolean not null default true,   -- may be GIVEN stale leads
  active            boolean not null default true,
  updated_at        timestamptz not null default now()
);

create index if not exists reassignment_teams_group_idx on public.reassignment_teams (open_border_group);
-- Owner id is the real join key from a deal → team; keep it unique when present.
create unique index if not exists reassignment_teams_owner_uidx
  on public.reassignment_teams (hubspot_owner_id)
  where hubspot_owner_id is not null;

comment on table public.reassignment_teams is
  'Open-border reassignment roster. A deal''s current hubspot_owner_id maps to a row here; stale leads move to a random other row in the same open_border_group with can_receive + active + a non-null owner id. Toggles are editable by super/admin from the dashboard.';

-- ── Audit: one row per reassignment decision (applied OR dry-run OR error) ─
create table if not exists public.lead_reassignments (
  id                bigint generated always as identity primary key,
  deal_id           text not null,
  deal_name         text,
  open_border_group text,
  from_owner_id     text,
  from_team         text,
  to_owner_id       text,
  to_team           text,
  contact_ids       text[],                  -- associated contacts whose owner was changed
  contacts_patched  integer,
  deal_patched      boolean,
  clock_origin      timestamptz,             -- greatest(hs_createdate, last_reassigned_at)
  deal_created_at   timestamptz,
  hop               integer,                 -- 1 = first move, 2 = second, …
  dry_run           boolean not null default true,
  status            text,                    -- applied | dry_run | error | skipped
  error             text,
  evaluated_at      timestamptz not null default now()
);

create index if not exists lead_reassignments_deal_idx on public.lead_reassignments (deal_id);
create index if not exists lead_reassignments_when_idx on public.lead_reassignments (evaluated_at desc);

comment on table public.lead_reassignments is
  'Audit log of every open-border reassignment decision. Written by the sync service role; read by super/admin on the dashboard. dry_run=true rows are intended moves that were logged but NOT applied to HubSpot.';

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.reassignment_teams enable row level security;
alter table public.lead_reassignments enable row level security;

-- Config: super/admin can read and flip toggles.
drop policy if exists "reassignment_teams: super/admin select" on public.reassignment_teams;
create policy "reassignment_teams: super/admin select"
  on public.reassignment_teams for select to authenticated
  using (exists (select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and (s.is_super = true or s.is_admin = true)
      and coalesce(s.active, true) = true));

drop policy if exists "reassignment_teams: super/admin update" on public.reassignment_teams;
create policy "reassignment_teams: super/admin update"
  on public.reassignment_teams for update to authenticated
  using (exists (select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and (s.is_super = true or s.is_admin = true)
      and coalesce(s.active, true) = true))
  with check (exists (select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and (s.is_super = true or s.is_admin = true)
      and coalesce(s.active, true) = true));

-- Audit: super/admin read only. All writes go through the service role.
drop policy if exists "lead_reassignments: super/admin select" on public.lead_reassignments;
create policy "lead_reassignments: super/admin select"
  on public.lead_reassignments for select to authenticated
  using (exists (select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and (s.is_super = true or s.is_admin = true)
      and coalesce(s.active, true) = true));

-- ── Seed: open-border roster from the division-area breakdown sheet ───────
-- Re-running preserves any toggles a super has changed: ON CONFLICT only
-- refreshes group + owner id, never the can_* flags or active.
insert into public.reassignment_teams (team, open_border_group, hubspot_owner_id, can_originate, can_receive) values
  -- WSB — Western Seaboard
  ('Babes',       'WSB', '61715183',   true, true),
  ('Weasels',     'WSB', '61983137',   true, true),
  ('Warriors',    'WSB', '61983888',   true, true),
  ('Spartans',    'WSB', '61951607',   true, true),
  ('Lions',       'WSB', '61022342',   true, true),
  ('Pirates',     'WSB', '57438698',   true, true),
  ('Knights',     'WSB', '61213531',   true, true),
  ('Fran',        'WSB', null,         true, false),  -- no owner id → originator only, never receives
  ('Slayers',     'WSB', '61951340',   true, true),
  ('Conquerors',  'WSB', '61985705',   true, true),
  ('Dolphins',    'WSB', '401875482',  true, true),
  -- NS — Northern Suburbs
  ('Ballers',     'NS',  '60766526',   true, true),
  ('Dragons',     'NS',  '84022188',   true, true),
  ('Cavaliers',   'NS',  '84018278',   true, true),
  ('Samurais',    'NS',  '84021524',   true, true),
  ('Targaryens',  'NS',  '84878181',   true, true),
  ('Headbangers', 'NS',  '195736166',  true, true),
  ('Gunslingers', 'NS',  '85377840',   true, true),
  ('Dealmakers',  'NS',  '221066166',  true, true),
  ('Chargers',    'NS',  '254689367',  true, true),
  ('Hawks',       'NS',  '342583654',  true, true),
  ('Falcons',     'NS',  '289663897',  true, true),
  ('Tigers',      'NS',  '290480467',  true, true),
  ('Panthers',    'NS',  '487152396',  true, true),
  ('Furys',       'NS',  '512880424',  true, true),
  ('Invincibles', 'NS',  '551111272',  true, true),
  ('Blitz',       'NS',  '87801132',   true, true),
  ('Jaguars',     'NS',  '772270706',  true, true),
  -- SP — South Peninsula
  ('Surfers',     'SP',  '223928394',  true, true),
  ('Tornadoes',   'SP',  '570999348',  true, true),
  ('Hoekers',     'SP',  '90886933',   true, true),
  ('Farmers',     'SP',  '571004737',  true, true),
  ('Vipers',      'SP',  '87800852',   true, true),
  ('Komorants',   'SP',  '87790103',   true, true),
  ('Mosquitoes',  'SP',  '90830340',   true, true),
  ('Llamas',      'SP',  '2141538252', true, true),
  ('Dixies',      'SP',  '537403564',  true, true),
  -- SW — Somerset West
  ('Swesties',    'SW',  '735062128',  true, true),
  ('Rockets',     'SW',  '1752588073', true, true),
  ('Bergscape',   'SW',  '79270572',   true, true),
  ('Retrievers',  'SW',  '91462678',   true, true)
on conflict (team) do update set
  open_border_group = excluded.open_border_group,
  hubspot_owner_id  = excluded.hubspot_owner_id,
  updated_at        = now();
