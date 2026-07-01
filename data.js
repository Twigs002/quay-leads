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
    if (!staff.is_super && !staff.is_admin) {
      await sb.auth.signOut();
      return { ok: false, error: "Superuser access required for the leads dashboard." };
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
    if (!staff || staff.active === false || (!staff.is_super && !staff.is_admin)) return null;
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

  function invalidate() { _cache = null; }

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

  return { client, signIn, signOut, getSession, loadAll, invalidate, addNote, triggerSync };
})();
