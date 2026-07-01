// Action Tracker — team-performance roll-up + filterable list of leads.
// Top section: per-team calls (DialFire vs Team) + deals (each path) for
// a selectable window (rolling 30 days or current calendar month).
// Bottom section: individual leads with editable notes. Notes autosave
// on blur / Enter — no per-row Save button, no page reload.
window.VIEWS = window.VIEWS || {};

// Persisted across renders within a session.
let __atState = { window: "month", sortBy: "deals_total", sortDir: "desc" };

function _rollupTeamActivity(rows, window) {
  const now = new Date();
  let from;
  if (window === "30d") {
    from = new Date(now); from.setDate(from.getDate() - 30);
  } else {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const fromIso = from.toISOString().slice(0, 10);
  const acc = new Map();
  for (const r of rows) {
    if (!r.day || r.day < fromIso) continue;
    let a = acc.get(r.team);
    if (!a) {
      a = {
        team: r.team,
        calls_dialfire: 0, calls_team: 0,
        deals_dialfire: 0, deals_team: 0, deals_other: 0,
      };
      acc.set(r.team, a);
    }
    a.calls_dialfire += r.calls_dialfire || 0;
    a.calls_team     += r.calls_team     || 0;
    a.deals_dialfire += r.deals_dialfire || 0;
    a.deals_team     += r.deals_team     || 0;
    a.deals_other    += r.deals_other    || 0;
  }
  const out = [];
  for (const a of acc.values()) {
    a.calls_total = a.calls_dialfire + a.calls_team;
    a.deals_total = a.deals_dialfire + a.deals_team + a.deals_other;
    a.ratio_dialfire = a.deals_total ? a.deals_dialfire / a.deals_total : 0;
    a.ratio_team = a.deals_total ? a.deals_team / a.deals_total : 0;
    out.push(a);
  }
  return out;
}

function _renderTeamSection(rows, user) {
  const { escapeHtml } = UTILS;
  const rolled = _rollupTeamActivity(rows, __atState.window);
  const myTeam = (user && user.division || "").trim().toLowerCase();

  const sortBy = __atState.sortBy;
  const dir = __atState.sortDir === "desc" ? -1 : 1;
  rolled.sort((a, b) => {
    const va = a[sortBy], vb = b[sortBy];
    if (typeof va === "string") return dir * va.localeCompare(vb);
    return dir * ((va || 0) - (vb || 0));
  });

  const pct = v => v ? (v * 100).toFixed(0) + "%" : "—";
  const tf = (v, active) =>
    `<button class="team-window-btn ${active ? "active" : ""}" data-window="${v}">${v === "30d" ? "Rolling 30 days" : "This month"}</button>`;

  const sortArrow = k =>
    __atState.sortBy === k ? (__atState.sortDir === "desc" ? " ▾" : " ▴") : "";
  const th = (label, k) =>
    `<th class="sort ${k === "team" ? "" : "num"}" data-key="${k}" style="cursor:pointer; user-select:none;">${escapeHtml(label)}${sortArrow(k)}</th>`;

  const totals = rolled.reduce((t, r) => ({
    calls_dialfire: t.calls_dialfire + r.calls_dialfire,
    calls_team:     t.calls_team + r.calls_team,
    deals_dialfire: t.deals_dialfire + r.deals_dialfire,
    deals_team:     t.deals_team + r.deals_team,
    deals_other:    t.deals_other + r.deals_other,
  }), { calls_dialfire:0, calls_team:0, deals_dialfire:0, deals_team:0, deals_other:0 });
  totals.calls_total = totals.calls_dialfire + totals.calls_team;
  totals.deals_total = totals.deals_dialfire + totals.deals_team + totals.deals_other;

  const empty = rolled.length === 0;

  return `
    <div class="card" style="padding: 20px; margin-bottom: 8px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:12px;">
        <div>
          <h3 style="margin:0;">Team performance</h3>
          <p class="muted small" style="margin:4px 0 0;">
            Calls placed to each team's contacts and deals created for each team, split by origin.
          </p>
        </div>
        <div class="segmented">
          ${tf("month", __atState.window === "month")}
          ${tf("30d",   __atState.window === "30d")}
        </div>
      </div>
      ${empty ? `<p class="muted">No team activity synced yet. It appears on the next sync.</p>` : `
      <div class="table-wrap">
        <table class="dt">
          <thead><tr>
            ${th("Team", "team")}
            ${th("DialFire calls", "calls_dialfire")}
            ${th("Team calls", "calls_team")}
            ${th("All calls", "calls_total")}
            ${th("DialFire → deals", "deals_dialfire")}
            ${th("Team → deals", "deals_team")}
            ${th("All deals", "deals_total")}
            ${th("DialFire %", "ratio_dialfire")}
          </tr></thead>
          <tbody>${rolled.map(r => {
            const mine = r.team && r.team.trim().toLowerCase() === myTeam;
            return `<tr${mine ? ' style="background:#FFF8DA;"' : ''}>
              <td>${escapeHtml(r.team)}${mine ? ' <span class="pill" style="background:#FDC503;color:#1A2746;">you</span>' : ''}</td>
              <td class="num">${r.calls_dialfire.toLocaleString()}</td>
              <td class="num">${r.calls_team.toLocaleString()}</td>
              <td class="num"><strong>${r.calls_total.toLocaleString()}</strong></td>
              <td class="num">${r.deals_dialfire.toLocaleString()}</td>
              <td class="num">${r.deals_team.toLocaleString()}</td>
              <td class="num"><strong>${r.deals_total.toLocaleString()}</strong></td>
              <td class="num">${pct(r.ratio_dialfire)}</td>
            </tr>`;
          }).join("")}</tbody>
          <tfoot><tr style="border-top:2px solid #1A2746;">
            <td><strong>Total</strong></td>
            <td class="num"><strong>${totals.calls_dialfire.toLocaleString()}</strong></td>
            <td class="num"><strong>${totals.calls_team.toLocaleString()}</strong></td>
            <td class="num"><strong>${totals.calls_total.toLocaleString()}</strong></td>
            <td class="num"><strong>${totals.deals_dialfire.toLocaleString()}</strong></td>
            <td class="num"><strong>${totals.deals_team.toLocaleString()}</strong></td>
            <td class="num"><strong>${totals.deals_total.toLocaleString()}</strong></td>
            <td class="num"><strong>${pct(totals.deals_total ? totals.deals_dialfire / totals.deals_total : 0)}</strong></td>
          </tr></tfoot>
        </table>
      </div>`}
    </div>
  `;
}

window.VIEWS["action-tracker"] = function (root, ctx) {
  const all = ctx.view.leads;
  const teamActivity = ctx.cache.teamActivity || [];
  const { escapeHtml, escapeAttr, fmtDate } = UTILS;
  let showAll = false;

  function visible() {
    let work = showAll ? all : all.filter(l => !l.worked);
    work = work.filter(l => l.email);
    return work;
  }

  function render() {
    const work = visible();
    const worked = work.filter(l => l.worked).length;
    const outstanding = work.length - worked;

    if (!all.length) {
      root.innerHTML = `<h2>Action Tracker</h2>${UTILS.emptyState()}`;
      return;
    }

    root.innerHTML = `
      <h2>Action Tracker</h2>

      ${_renderTeamSection(teamActivity, ctx.user)}

      <h3 style="margin-top: 32px;">Individual leads</h3>
      <p class="lede">
        <strong>Worked</strong> comes from HubSpot — a deal with a logged call.
        This page is for adding <strong>notes</strong> against leads (saves to Supabase).
        The source sheet is never edited.
      </p>

      <label class="row" style="display:inline-flex; align-items:center; gap:8px; margin-bottom: 12px;">
        <input type="checkbox" id="show-all" ${showAll ? "checked" : ""}>
        <span>Show all leads (including ones already worked)</span>
      </label>

      <p><strong>${work.length.toLocaleString()}</strong> leads · <strong>${worked.toLocaleString()}</strong> already worked · <strong>${outstanding.toLocaleString()}</strong> outstanding</p>

      <p class="muted small">Notes save automatically when you leave the field or press Enter.</p>

      <div class="table-wrap">
        <table class="dt">
          <thead><tr>
            <th>Date</th>
            <th>Client</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Suburb</th>
            <th>Division</th>
            <th>Source</th>
            <th>Lead type</th>
            <th>HubSpot stage</th>
            <th class="num">Calls</th>
            <th>Worked</th>
            <th>Note</th>
          </tr></thead>
          <tbody>${work.slice(0, 500).map(row).join("")}</tbody>
        </table>
      </div>
      ${work.length > 500 ? `<p class="muted small" style="margin-top:8px;">Showing first 500 of ${work.length.toLocaleString()}. Refine filters to narrow.</p>` : ""}

      <h3 style="margin-top: 24px;">Recent notes</h3>
      <div id="recent-notes"></div>
    `;

    // Team-section window toggle
    root.querySelectorAll(".team-window-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        __atState.window = btn.dataset.window;
        render();
      });
    });

    // Team-section sortable column headers
    root.querySelectorAll("th.sort").forEach(th => {
      th.addEventListener("click", () => {
        const k = th.dataset.key;
        if (__atState.sortBy === k) {
          __atState.sortDir = __atState.sortDir === "desc" ? "asc" : "desc";
        } else {
          __atState.sortBy = k;
          __atState.sortDir = k === "team" ? "asc" : "desc";
        }
        render();
      });
    });

    document.getElementById("show-all").addEventListener("change", e => {
      showAll = e.target.checked;
      render();
    });

    // Autosave on blur or Enter — no Save button needed.
    root.querySelectorAll("input.note-input").forEach(input => {
      const original = input.value;
      const save = async () => {
        const text = (input.value || "").trim();
        if (text === (original || "").trim()) return; // unchanged
        input.classList.add("saving");
        try {
          await DATA.addNote(input.dataset.email, text, ctx.user.username);
          input.classList.remove("saving");
          input.classList.add("saved");
          // Mutate the in-memory cache so the row reflects the new note
          // without a page reload.
          const lead = ctx.cache.leads.find(l => (l.email || "").toLowerCase() === input.dataset.email.toLowerCase());
          if (lead) {
            lead.action_note = text;
            lead.note_at = new Date().toISOString();
            lead.note_by = ctx.user.username;
          }
          setTimeout(() => input.classList.remove("saved"), 1500);
          renderRecent();
        } catch (e) {
          input.classList.remove("saving");
          input.classList.add("error");
          input.title = "Failed to save: " + (e.message || e);
        }
      };
      input.addEventListener("blur", save);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { input.value = original; input.blur(); }
      });
    });

    renderRecent();
  }

  function renderRecent() {
    const recent = ctx.cache.leads
      .filter(l => l.note_at)
      .sort((a, b) => (b.note_at || "").localeCompare(a.note_at || ""))
      .slice(0, 30);
    const el = document.getElementById("recent-notes");
    if (!el) return;
    el.innerHTML = recent.length === 0
      ? '<p class="muted">No notes yet.</p>'
      : `<div class="table-wrap"><table class="dt">
          <thead><tr><th>When</th><th>Who</th><th>Lead</th><th>Note</th></tr></thead>
          <tbody>${recent.map(l => `<tr>
            <td>${fmtDate(l.note_at)}</td>
            <td>${escapeHtml(l.note_by || "")}</td>
            <td>${escapeHtml(l.client_name || l.email)}</td>
            <td>${escapeHtml(l.action_note || "")}</td>
          </tr>`).join("")}</tbody></table></div>`;
  }

  function row(l) {
    return `<tr>
      <td>${fmtDate(l.datestamp)}</td>
      <td>${escapeHtml(l.client_name || "")}</td>
      <td>${escapeHtml(l.email || "")}</td>
      <td>${escapeHtml(l.phone || "")}</td>
      <td>${escapeHtml(l.suburb || "")}</td>
      <td>${escapeHtml(l.division || "")}</td>
      <td>${escapeHtml(l.source || "")}</td>
      <td>${escapeHtml(l.is_lead || "")}</td>
      <td>${escapeHtml(l.current_stage || "")}</td>
      <td class="num">${l.num_calls || 0}</td>
      <td>${l.worked ? '<span class="pill green">Worked</span>' : ''}</td>
      <td><input class="note-input" type="text" placeholder="add note, Enter to save…" data-email="${escapeAttr(l.email)}" value="${escapeAttr(l.action_note || "")}"></td>
    </tr>`;
  }

  render();
};
