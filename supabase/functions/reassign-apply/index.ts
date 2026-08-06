// Edge Function: reassign-apply
// =================================================================
// Manual, one-deal-at-a-time reassignment. A super/admin clicks "Apply" on a
// candidate row in the dashboard; the browser calls this function with the
// deal id and the chosen target owner; this function does the real HubSpot
// move server-side (the private token never touches the client).
//
// Flow:
//   1. Verify the caller is an authenticated super/admin Supabase user
//   2. Load the deal + roster; validate the move is legal (same open-border
//      group, target can_receive + active + has owner id, not the current
//      owner, not a team that has already held this deal)
//   3. PATCH the deal owner in HubSpot, then every associated contact owner
//   4. Persist the move to hs_deal_state (owner, clock reset, hop, visited)
//   5. Write an applied row to lead_reassignments and return a summary
//
// Secrets required (set with `supabase secrets set`):
//   HUBSPOT_TOKEN — private-app token with crm.objects.deals + .contacts
//                   read/write on the Quay 1 portal
//
// Deploy:
//   supabase functions deploy reassign-apply --project-ref dqszbqiimbfvmmnpgpsb

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const HS_API = "https://api.hubapi.com";
// Deals must be sitting in one of these to be reassignable (matches the
// candidate query in data.js / reassign.py). Guards against a deal that moved
// stage between page load and the click.
const QUALIFYING_STAGES = new Set(["External Lead", "Calling Lead", "Inbound Lead"]);

const ALLOWED_ORIGINS = new Set([
  "https://twigs002.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

function corsFor(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://twigs002.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(origin), "Content-Type": "application/json" },
  });
}

async function hsPatchOwner(token: string, objectType: string, id: string, ownerId: string) {
  const r = await fetch(`${HS_API}/crm/v3/objects/${objectType}/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { hubspot_owner_id: String(ownerId) } }),
  });
  if (!r.ok) throw new Error(`HubSpot ${objectType} PATCH ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function hsDealContacts(token: string, dealId: string): Promise<string[]> {
  const r = await fetch(`${HS_API}/crm/v4/objects/deals/${dealId}/associations/contacts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return [];
  const body = await r.json().catch(() => ({}));
  return (body.results || []).map((x: { toObjectId?: string | number }) => String(x.toObjectId)).filter(Boolean);
}

serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing Authorization header" }, 401, origin);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const HUBSPOT_TOKEN = Deno.env.get("HUBSPOT_TOKEN");
  if (!HUBSPOT_TOKEN) return json({ error: "HUBSPOT_TOKEN secret not configured" }, 500, origin);

  // 1. Authenticate + authorise (super/admin only).
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: "Not authenticated" }, 401, origin);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: staff } = await admin.from("staff")
    .select("id, name, is_super, is_admin, active")
    .eq("auth_user_id", userRes.user.id).maybeSingle();
  if (!staff) return json({ error: "No staff record for this account" }, 403, origin);
  if (staff.active === false) return json({ error: "Account is disabled" }, 403, origin);
  if (!staff.is_super && !staff.is_admin) return json({ error: "Superuser access required" }, 403, origin);

  // 2. Parse + validate the requested move.
  const payload = await req.json().catch(() => ({}));
  const dealId = String(payload.deal_id || "").trim();
  const toOwnerId = String(payload.to_owner_id || "").trim();
  if (!dealId || !toOwnerId) return json({ error: "deal_id and to_owner_id are required" }, 400, origin);

  const { data: deal, error: dealErr } = await admin.from("hs_deal_state")
    .select("deal_id, deal_name, current_stage, hubspot_owner_id, num_calls, hs_createdate, last_reassigned_at, reassign_hops, reassign_visited")
    .eq("deal_id", dealId).maybeSingle();
  if (dealErr) return json({ error: `deal lookup failed: ${dealErr.message}` }, 500, origin);
  if (!deal) return json({ error: "Deal not found" }, 404, origin);
  if (!QUALIFYING_STAGES.has(deal.current_stage)) {
    return json({ error: `Deal is in "${deal.current_stage}", not a qualifying stage. It may have moved since the page loaded.` }, 409, origin);
  }

  const fromOwner = String(deal.hubspot_owner_id || "").trim();
  if (!fromOwner) return json({ error: "Deal has no current owner to move from" }, 409, origin);
  if (toOwnerId === fromOwner) return json({ error: "Target team is already the current owner" }, 409, origin);

  const { data: roster } = await admin.from("reassignment_teams").select("*");
  const byOwner = new Map((roster || []).map((t) => [String(t.hubspot_owner_id || ""), t]));
  const fromTeam = byOwner.get(fromOwner);
  const toTeam = byOwner.get(toOwnerId);
  if (!fromTeam || !fromTeam.can_originate || !fromTeam.active || !fromTeam.open_border_group) {
    return json({ error: "Current team is not an active originating open-border team" }, 409, origin);
  }
  if (!toTeam) return json({ error: "Target owner is not on the reassignment roster" }, 409, origin);
  if (toTeam.open_border_group !== fromTeam.open_border_group) {
    return json({ error: "Target team is in a different open-border area" }, 409, origin);
  }
  if (!toTeam.can_receive || !toTeam.active) {
    return json({ error: "Target team cannot receive right now" }, 409, origin);
  }
  const visited = new Set((deal.reassign_visited || []).map((x: unknown) => String(x)));
  if (visited.has(toOwnerId)) {
    return json({ error: "Target team has already held this deal (anti ping-pong)" }, 409, origin);
  }

  const now = new Date().toISOString();
  const hop = (Number(deal.reassign_hops) || 0) + 1;

  // 3. Move the deal in HubSpot first — the only step that fails the record.
  try {
    await hsPatchOwner(HUBSPOT_TOKEN, "deals", dealId, toOwnerId);
  } catch (e) {
    await admin.from("lead_reassignments").insert({
      deal_id: dealId, deal_name: deal.deal_name, open_border_group: fromTeam.open_border_group,
      from_owner_id: fromOwner, from_team: fromTeam.team, to_owner_id: toOwnerId, to_team: toTeam.team,
      hop, dry_run: false, deal_patched: false, status: "error",
      error: `manual apply by ${staff.name}: ${String((e as Error).message).slice(0, 400)}`,
      evaluated_at: now,
    });
    return json({ error: `HubSpot move failed: ${(e as Error).message}` }, 502, origin);
  }

  // 4. Persist state BEFORE contacts so the deal can't be re-picked even if a
  //    later step fails.
  const nextVisited = [...new Set([...visited, fromOwner, toOwnerId])];
  let stateErr: string | null = null;
  const { error: upErr } = await admin.from("hs_deal_state").update({
    hubspot_owner_id: toOwnerId, last_reassigned_at: now, reassign_hops: hop, reassign_visited: nextVisited,
  }).eq("deal_id", dealId);
  if (upErr) stateErr = upErr.message;

  // 5. Best-effort contact-owner move (docstring promises both).
  let contactsPatched = 0;
  const contactIds = await hsDealContacts(HUBSPOT_TOKEN, dealId);
  for (const cid of contactIds) {
    try { await hsPatchOwner(HUBSPOT_TOKEN, "contacts", cid, toOwnerId); contactsPatched++; } catch { /* one bad contact must not sink the move */ }
  }

  await admin.from("lead_reassignments").insert({
    deal_id: dealId, deal_name: deal.deal_name, open_border_group: fromTeam.open_border_group,
    from_owner_id: fromOwner, from_team: fromTeam.team, to_owner_id: toOwnerId, to_team: toTeam.team,
    contact_ids: contactIds, contacts_patched: contactsPatched, deal_patched: true,
    clock_origin: deal.last_reassigned_at || deal.hs_createdate || now,
    deal_created_at: deal.hs_createdate || null, hop, dry_run: false, status: "applied",
    error: stateErr ? `manual apply by ${staff.name}; deal+contacts moved but state not persisted: ${stateErr}` : `manual apply by ${staff.name}`,
    evaluated_at: now,
  });

  return json({
    ok: true, deal_id: dealId, from_team: fromTeam.team, to_team: toTeam.team,
    contacts_patched: contactsPatched, hop, applied_by: staff.name,
  }, 200, origin);
});
