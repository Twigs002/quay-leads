-- Quay Leads — sale → lead attribution (Dialfire vs Seller Lead Bank)
-- =================================================================
-- Adds the RESULT of matching each register sale back to the lead that
-- generated it. The match itself runs in the sync (in memory) using seller
-- phone / name / address against the leads book; only the outcome is stored
-- here — NO client PII ever lands in the database.
--
--   lead_origin      'dialfire' | 'slb' | null   (null = no lead matched)
--   lead_matched     true when a lead was matched
--   match_method     'phone' | 'name' | 'address' | null (confidence signal)
--   matched_deal_id  HubSpot deal id of the matched lead, when it had one
--
-- sales_deals is `select s.*` so these flow through to the browser automatically;
-- re-created here so PostgREST refreshes the view's column list.

alter table public.sales_register
  add column if not exists lead_origin     text,
  add column if not exists lead_matched    boolean default false,
  add column if not exists match_method    text,
  add column if not exists matched_deal_id text;

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
  'Super/admin-only view of the sales/commission register (actuals) + lead attribution (lead_origin/lead_matched/match_method). No client PII. Runs as owner (security_invoker off).';
