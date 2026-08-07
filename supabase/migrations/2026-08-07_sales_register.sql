-- Quay Leads — commission / sales register (actuals)
-- =================================================================
-- Ingests the company sales & commission register (the "Quay-leads" sheet:
-- every deal with address, price, commission breakdown, team and dealStatus)
-- so the dashboard's economics can use ACTUAL banked commission instead of the
-- mandate-as-sale proxy. Feeds real suburb x title-type averages into
-- Costings/CFO and a new Actuals/Revenue view.
--
-- PRIVACY: this table deliberately stores NO client PII. The source sheet has
-- seller/purchaser names, ID numbers, cellphones and emails; the sync excludes
-- all of them. Only economic fields, the property address (for suburb rollups),
-- the team (division), and the lead broker's name (staff, not a client) land here.
--
-- Written by the GitHub Action (service role, bypasses RLS). Read by the browser
-- only through the super/admin-gated sales_deals view below.

create table if not exists public.sales_register (
  id                  text primary key,          -- source sheet row id
  division_name       text,                       -- team (Assassins, Wombats, ...)
  deal_status         text,                       -- PAID_OUT | OPEN | FALLEN_THROUGH | DUPLICATE | *_APPROVED
  property_type       text,                       -- "Full Title" | "Sectional Title"
  title_code          text,                       -- derived: FT | ST | null
  is_rental           boolean default false,      -- derived: divisionName starts with "Rentals"
  ref_number          text,
  transfer_date       date,
  acceptance_date     date,
  po_date             date,
  broker_pay_date     date,
  street_number       text,
  street_name         text,
  suburb              text,
  township            text,
  purchase_price      numeric,
  commission_pct      numeric,
  commission_excl_vat numeric,
  commission_incl_vat numeric,
  total_gross_comm    numeric,
  quay1_comm          numeric,
  quay1_gross_comm    numeric,                     -- what Quay 1 actually banks (incl VAT share)
  quay1_comm_net      numeric,
  broker1_name        text,                        -- lead broker (staff)
  broker1_comm_gross  numeric,
  synced_at           timestamptz default now()
);

create index if not exists sales_register_suburb_idx on public.sales_register (lower(suburb));
create index if not exists sales_register_division_idx on public.sales_register (division_name);
create index if not exists sales_register_status_idx on public.sales_register (deal_status);

alter table public.sales_register enable row level security;
-- No permissive policy for anon/authenticated → browsers cannot read the raw
-- table directly; only the service role (sync) writes, and reads go through the
-- gated view below.

-- ── Super/admin-gated browser view (no client PII) ───────────────────────────
-- Same caller-scope pattern as leads_enriched, but sales figures are whole-book
-- sensitive so ONLY super/admin see any rows (team members see nothing here).
drop view if exists public.sales_deals;
create view public.sales_deals
with (security_invoker = off) as
select s.*
from public.sales_register s
where exists (
  select 1 from public.staff c
  where c.auth_user_id = auth.uid()
    and coalesce(c.active, true)
    and (coalesce(c.is_super, false) or coalesce(c.is_admin, false))
);

grant select on public.sales_deals to authenticated;

comment on view public.sales_deals is
  'Super/admin-only view of the sales/commission register (actuals). No client PII. Economic fields + address + team + lead broker only. Runs as owner (security_invoker off).';
