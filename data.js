// Supabase data layer.
// Fetches leads + hs_deal_state, joins them client-side, returns one
// enriched dataframe-like array used by all views.
window.DATA = (() => {
  let _client = null;
  let _cache = null;

  function client() {
    if (!_client) {
      _client = supabase.createClient(QUAY.SUPABASE_URL, QUAY.SUPABASE_ANON_KEY);
    }
    return _client;
  }

  function emailFor(username) {
    return `${(username || "").toLowerCase().trim()}@${QUAY.AUTH_EMAIL_DOMAIN}`;
  }

  async function signIn(username, pin) {
    const sb = client();
    const { data, error } = await sb.auth.signInWithPassword({
      email: emailFor(username), password: pin,
    });
    if (error) return { ok: false, error: "Username or PIN not recognised." };
    if (!data.user) return { ok: false, error: "Login failed." };
    // Verify the user is a superuser in staff
    const { data: staff } = await sb.from("staff").select("*").eq("auth_user_id", data.user.id).maybeSingle();
    if (!staff) { await sb.auth.signOut(); return { ok: false, error: "No staff record." }; }
    if (staff.active === false) { await sb.auth.signOut(); return { ok: false, error: "Account is disabled." }; }
    // Any active staff can log in. What they see is server-scoped by
    // the leads_enriched view — super/admin get all leads, everyone
    // else sees only their team's rows (matched via staff.division).
    if (!staff.division && !staff.is_super && !staff.is_admin) {
      await sb.auth.signOut();
      return { ok: false, error: "No division on file — ask an admin to set your team." };
    }
    return { ok: true, user: {
      username: staff.id, name: staff.name,
      email: data.user.email, division: staff.division,
      isSuper: !!staff.is_super, isAdmin: !!staff.is_admin,
    }};
  }

  async function signOut() {
    await client().auth.signOut();
    _cache = null;
  }

  async function getSession() {
    const sb = client();
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    const { data: staff } = await sb.from("staff").select("*").eq("auth_user_id", data.session.user.id).maybeSingle();
    if (!staff || staff.active === false) return null;
    // Team members must have a division; admins/supers don't need one.
    if (!staff.division && !staff.is_super && !staff.is_admin) return null;
    return {
      username: staff.id, name: staff.name,
      email: data.session.user.email, division: staff.division,
      isSuper: !!staff.is_super, isAdmin: !!staff.is_admin,
    };
  }

  // Paginated read — Supabase REST caps at 1000 rows per request.
  // Loops until a page returns < PAGE OR exactly 0 rows (so a final full
  // page that's also the last page exits cleanly on the next iteration).
  async function _allRows(table, select = "*") {
    const sb = client();
    const PAGE = 1000;
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select(select).range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    return rows;
  }

  async function loadAll(force = false) {
    if (_cache && !force) return _cache;
    // ONE paginated query against the leads_enriched view (joins leads +
    // hs_deal_state + latest lead_actions server-side). Down from 4
    // parallel chains × ~12 round trips → 1 chain × ~12 round trips with
    // joins already done.
    const [enriched, status, teamActivity] = await Promise.all([
      _allRows("leads_enriched"),
      _allRows("sync_status"),
      _allRows("team_activity_daily"),
    ]);
    for (const l of enriched) {
      l.datestamp_d = l.datestamp ? new Date(l.datestamp) : null;
      l.has_deal = !!l.has_deal;
      l.worked = !!l.worked;
      l.num_calls = l.num_calls || 0;
    }
    const syncMain = status.find(s => s.name === "leads_sync");
    const syncTeam = status.find(s => s.name === "team_activity_sync");
    _cache = {
      leads: enriched,
      teamActivity: teamActivity || [],
      lastSync: syncMain ? syncMain.last_synced_at : null,
      syncOk: syncMain ? !!syncMain.ok : null,
      syncMessage: syncMain ? syncMain.message : null,
      lastTeamSync: syncTeam ? syncTeam.last_synced_at : null,
      teamSyncOk: syncTeam ? !!syncTeam.ok : null,
    };
    return _cache;
  }

  // Per-deal call history — Track tab pulls this lazily when a row expands.
  // Small per-deal-id cache so re-expanding the same row doesn't refetch.
  const _callsCache = new Map();

  function invalidate() { _cache = null; _callsCache.clear(); }

  async function getDealCalls(dealId) {
    const key = String(dealId || "");
    if (!key) return [];
    if (_callsCache.has(key)) return _callsCache.get(key);
    const sb = client();
    const { data, error } = await sb
      .from("hs_deal_calls")
      .select("call_id, ts, direction, disposition, hubspot_owner_id, duration_sec, notes")
      .eq("deal_id", key)
      .order("ts", { ascending: false })
      .limit(500);
    if (error) throw error;
    const rows = data || [];
    _callsCache.set(key, rows);
    return rows;
  }

  async function addNote(email, note, actionedBy) {
    const { error } = await client().from("lead_actions").insert({
      email: (email || "").toLowerCase().trim(),
      actioned: true,
      note: (note || "").trim(),
      actioned_by: actionedBy,
    });
    if (error) throw error;
    invalidate();
  }

  // One-click sync trigger via the trigger-sync Edge Function.
  async function triggerSync() {
    const sb = client();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error("Not signed in");
    const res = await fetch(`${QUAY.SUPABASE_URL}/functions/v1/trigger-sync`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        "apikey": QUAY.SUPABASE_ANON_KEY,
      },
      body: "{}",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  // ── Open-border reassignment (super/admin only via RLS) ────────────────
  // Loads the team roster + recent audit log. Returns { ready:false } when
  // the tables don't exist yet (migration not run) so the view can show a
  // setup hint instead of erroring.
  function _missingTable(err) {
    if (!err) return false;
    // Postgres undefined_table (42P01) or PostgREST schema-cache miss (PGRST205).
    if ((err.code || "") === "42P01" || (err.code || "") === "PGRST205") return true;
    return /does not exist|schema cache|could not find the table/i.test(err.message || "");
  }

  async function loadReassignment() {
    const sb = client();
    try {
      const [teams, log] = await Promise.all([
        sb.from("reassignment_teams").select("*").order("open_border_group").order("team"),
        sb.from("lead_reassignments").select("*").order("evaluated_at", { ascending: false }).limit(500),
      ]);
      if (teams.error) {
        if (_missingTable(teams.error)) return { ready: false, teams: [], log: [] };
        throw teams.error;
      }
      return { ready: true, teams: teams.data || [], log: (log && log.data) || [] };
    } catch (e) {
      if (_missingTable(e)) return { ready: false, teams: [], log: [] };
      throw e;
    }
  }

  // Qualifying deal stages for reassignment (labels as they land in
  // hs_deal_state.current_stage). Kept here so the view and a future
  // evaluator share one source of truth.
  const REASSIGN_STAGES = ["External Lead", "Calling Lead", "Inbound Lead"];

  // Candidate deals: currently in a qualifying stage with no calls logged.
  // Owner→team mapping + the 72h age cut are applied in the view (it already
  // holds the roster). Returns raw deal rows; [] with ready:false semantics
  // handled by the caller. hs_createdate is the 72h clock origin (null until
  // the next sync backfills it).
  async function loadReassignmentCandidates() {
    const sb = client();
    const cols = "deal_id, deal_name, current_stage, hubspot_owner_id, num_calls, hs_createdate, last_reassigned_at, reassign_hops";
    const PAGE = 1000;
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const q = sb.from("hs_deal_state").select(cols)
        .in("current_stage", REASSIGN_STAGES)
        .or("num_calls.eq.0,num_calls.is.null")
        .range(from, from + PAGE - 1);
      const { data, error } = await q;
      if (error) {
        if (_missingTable(error)) return { ready: false, deals: [] };
        throw error;
      }
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    return { ready: true, deals: rows };
  }

  // Flip a single toggle (can_originate | can_receive | active) on one team.
  async function setTeamToggle(team, field, value) {
    const allowed = new Set(["can_originate", "can_receive", "active"]);
    if (!allowed.has(field)) throw new Error(`bad field: ${field}`);
    const patch = {};
    patch[field] = !!value;
    patch.updated_at = new Date().toISOString();
    const { error } = await client().from("reassignment_teams").update(patch).eq("team", team);
    if (error) throw error;
  }

  return { client, signIn, signOut, getSession, loadAll, invalidate, addNote, getDealCalls, triggerSync, loadReassignment, loadReassignmentCandidates, setTeamToggle, REASSIGN_STAGES };
})();
