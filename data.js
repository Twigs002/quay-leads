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
  async function _allRows(table, select = "*") {
    const sb = client();
    const PAGE = 1000;
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select(select).range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  }

  async function loadAll(force = false) {
    if (_cache && !force) return _cache;
    const [leads, deals, status, actions] = await Promise.all([
      _allRows("leads"),
      _allRows("hs_deal_state"),
      _allRows("sync_status"),
      _allRows("lead_actions"),
    ]);
    const dealMap = new Map(deals.map(d => [String(d.deal_id), d]));
    const noteMap = new Map();
    for (const a of actions) {
      const k = (a.email || "").toLowerCase();
      const prev = noteMap.get(k);
      if (!prev || (a.actioned_at || "") > (prev.actioned_at || "")) {
        noteMap.set(k, a);
      }
    }
    for (const l of leads) {
      l.datestamp_d = l.datestamp ? new Date(l.datestamp) : null;
      const d = l.deal_id ? dealMap.get(String(l.deal_id)) : null;
      l.has_deal = !!l.deal_id;
      l.action_flag = l.has_deal ? "Has Deal" : "Retry / Action Needed";
      l.current_stage = d ? d.current_stage : null;
      l.amount = d ? d.amount : null;
      l.close_date = d ? d.close_date : null;
      l.hs_last_modified = d ? d.hs_last_modified : null;
      l.num_calls = d ? (d.num_calls || 0) : 0;
      l.worked = l.num_calls > 0;
      const note = noteMap.get((l.email || "").toLowerCase());
      l.action_note = note ? note.note : null;
      l.note_at = note ? note.actioned_at : null;
      l.note_by = note ? note.actioned_by : null;
    }
    const syncMain = status.find(s => s.name === "leads_sync");
    _cache = {
      leads,
      lastSync: syncMain ? syncMain.last_synced_at : null,
      syncOk: syncMain ? !!syncMain.ok : null,
      syncMessage: syncMain ? syncMain.message : null,
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

  return { client, signIn, signOut, getSession, loadAll, invalidate, addNote };
})();
