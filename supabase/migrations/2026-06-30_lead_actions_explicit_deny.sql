-- Explicit deny for UPDATE/DELETE on lead_actions.
-- =================================================================
-- The table is INSERT-only by design (append-only audit log of notes).
-- RLS is restrictive by default — without policies, nothing happens —
-- but adding an explicit deny documents intent and prevents a future
-- "for all to authenticated using (true)" footgun.

drop policy if exists "lead_actions: deny update" on public.lead_actions;
create policy "lead_actions: deny update"
  on public.lead_actions for update to authenticated
  using (false) with check (false);

drop policy if exists "lead_actions: deny delete" on public.lead_actions;
create policy "lead_actions: deny delete"
  on public.lead_actions for delete to authenticated
  using (false);

comment on policy "lead_actions: deny update" on public.lead_actions is
  'Append-only design: notes cannot be edited after the fact (audit trail).';
comment on policy "lead_actions: deny delete" on public.lead_actions is
  'Append-only design: notes cannot be deleted.';
