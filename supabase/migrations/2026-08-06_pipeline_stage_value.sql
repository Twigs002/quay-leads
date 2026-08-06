-- Quay Leads — whole-book pipeline value by deal stage
--
-- The dashboard's leads_enriched view only covers seller-lead deals, and those
-- lead-stage deals almost never carry an `amount`, so the CFO "Pipeline value by
-- stage" chart summed to R0. This table holds the WHOLE default sales pipeline
-- aggregated by stage (gross amount, probability-weighted amount, deal count,
-- open flag) so the CFO view can show real pipeline value. It is unfiltered by
-- the dashboard's date/division filters by design (it is a book-wide total).
--
-- Written by scripts/sync.py using the service role (bypasses RLS). Read by
-- super/admin staff only, matching the CFO view's sensitivity.

create table if not exists public.pipeline_stage_value (
  stage       text primary key,
  is_open     boolean     not null default true,
  gross       numeric     not null default 0,
  weighted    numeric     not null default 0,
  deal_count  integer     not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.pipeline_stage_value enable row level security;

-- Super/admin read only. All writes go through the service role.
drop policy if exists "pipeline_stage_value: super/admin select" on public.pipeline_stage_value;
create policy "pipeline_stage_value: super/admin select"
  on public.pipeline_stage_value for select to authenticated
  using (exists (select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and (s.is_super = true or s.is_admin = true)
      and coalesce(s.active, true) = true));

grant select on public.pipeline_stage_value to authenticated;

comment on table public.pipeline_stage_value is
  'Whole default-pipeline deal book aggregated by stage (gross, probability-weighted, count, open flag). Written by sync.py service role; super/admin read only. Feeds the CFO Pipeline value by stage chart. Not scoped by dashboard filters.';
