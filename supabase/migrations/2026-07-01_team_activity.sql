-- Quay 1 Seller Leads — per-team activity roll-up
-- =================================================================
-- Daily buckets of DialFire calls, Team (manual) calls, and deals
-- created via each path, one row per (team, day). The frontend sums
-- whichever window is active (rolling 30d or current calendar month).
--
-- Populated every 30 min by scripts/sync.py (existing GitHub Action).
--
-- RLS: super/admin see every team. Any other authenticated staff row
-- can only see days for their own `staff.division`.

create table if not exists public.team_activity_daily (
  team            text not null,
  day             date not null,
  calls_dialfire  integer not null default 0,
  calls_team      integer not null default 0,
  deals_dialfire  integer not null default 0,
  deals_team      integer not null default 0,
  deals_other     integer not null default 0,
  refreshed_at    timestamptz not null default now(),
  primary key (team, day)
);

create index if not exists team_activity_daily_day_idx
  on public.team_activity_daily (day desc);
create index if not exists team_activity_daily_team_idx
  on public.team_activity_daily (team);

alter table public.team_activity_daily enable row level security;

-- Super/admin: full read.
drop policy if exists "team_activity_daily: super/admin select"
  on public.team_activity_daily;
create policy "team_activity_daily: super/admin select"
  on public.team_activity_daily for select to authenticated
  using (
    exists (
      select 1 from public.staff s
      where s.auth_user_id = auth.uid()
        and (s.is_super = true or s.is_admin = true)
        and coalesce(s.active, true) = true
    )
  );

-- Team members: read only their own team's rows.
-- Match on trimmed, case-folded division to survive small casing drift.
drop policy if exists "team_activity_daily: own team select"
  on public.team_activity_daily;
create policy "team_activity_daily: own team select"
  on public.team_activity_daily for select to authenticated
  using (
    exists (
      select 1 from public.staff s
      where s.auth_user_id = auth.uid()
        and coalesce(s.active, true) = true
        and lower(trim(coalesce(s.division, ''))) = lower(trim(team))
        and s.division is not null
        and s.division <> ''
    )
  );

-- Writes only via service-role (GitHub Action). Browser never writes here.

comment on table public.team_activity_daily is
  'Per-team daily counts of DialFire calls, Team calls, and deals from each origin. Synced by scripts/sync.py. Frontend rolls up to 30d or calendar-month window.';
