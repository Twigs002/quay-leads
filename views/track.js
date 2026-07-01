// Track — search any single lead and see exactly where it landed in
// HubSpot. Type an address, name, phone, email, or deal ID and get the
// full trace: sheet arrival → division/team it went to → HubSpot deal
// owner → current stage → calls → notes → last activity.
window.VIEWS = window.VIEWS || {};

// Persist state across renders (search term, expanded row) within a session.
let __trackState = { q: "", expanded: null, team: "", from: "", to: "" };

// Owner-id → team name. Built once from ctx.cache.leads by voting on
// (hubspot_div_id, division) pairs — same logic as scripts/team_activity_sync.py
// but done client-side so we don't need a new API round-trip.
function _ownerTeamMap(leads) {
  const votes = new Map();
  for (const l of leads) {
    const oid = (l.hubspot_div_id || "").toString().trim();
    const div = (l.division || "").trim();
    if (!oid || !div || div.toUpperCase() === "UPDATED BELOW") continue;
    let m = votes.get(oid);
    if (!m) { m = new Map(); votes.set(oid, m); }
    m.set(div, (m.get(div) || 0) + 1);
  }
  const out = new Map();
  for (const [oid, m] of votes) {
    let best = null, bestN = 0;
    for (const [div, n] of m) if (n > bestN) { best = div; bestN = n; }
    if (best) out.set(oid, best);
  }
  return out;
}

const HUBSPOT_PORTAL_ID = "8870419"; // Quay 1

function _hsDealLink(dealId) {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${encodeURIComponent(dealId)}`;
}
function _hsOwnerLink(ownerId) {
  return `https://app.hubspot.com/settings/${HUBSPOT_PORTAL_ID}/users?userId=${encodeURIComponent(ownerId)}`;
}

function _stageTone(stage) {
  const s = (stage || "").toLowerCase();
  if (!s) return "muted";
  if (s.includes("won")   || s.includes("closed won")) return "green";
  if (s.includes("lost")  || s.includes("closed lost")) return "red";
  if (s.includes("hot")   || s.includes("appraisal") || s.includes("mandated")) return "green";
  if (s.includes("warm")  || s.includes("nurtur")   || s.includes("qualif"))    return "amber";
  return "muted";
}

window.VIEWS["track"] = function (root, ctx) {
  const { escapeHtml, escapeAttr, fmtDate, fmtShortDate, humanAgo } = UTILS;
  const all = ctx.cache.leads;          // full cache — Track ignores sidebar filters
  const ownerTeam = _ownerTeamMap(all);

  function matches(l, q) {
    if (!q) return false;
    const blob = [
      l.client_name, l.email, l.phone, l.phone && l.phone.replace(/\D/g, ""),
      l.property_address, l.suburb, l.property_type,
      l.division, l.source, l.deal_id, l.hubspot_div_id,
    ].map(v => String(v || "").toLowerCase()).join(" | ");
    return blob.includes(q.toLowerCase());
  }

  // Unique teams for the dropdown — combined from sheet divisions +
  // owner→team map. Excludes noise like "UPDATED BELOW".
  const teams = (() => {
    const s = new Set();
    for (const l of all) {
      const d = (l.division || "").trim();
      if (d && d.toUpperCase() !== "UPDATED BELOW") s.add(d);
    }
    for (const t of ownerTeam.values()) if (t) s.add(t);
    return [...s].sort((a, b) => a.localeCompare(b));
  })();

  function inWindow(l) {
    const t = __trackState;
    if (t.from && (!l.datestamp || l.datestamp.slice(0, 10) < t.from)) return false;
    if (t.to   && (!l.datestamp || l.datestamp.slice(0, 10) > t.to))   return false;
    if (t.team) {
      const div = (l.division || "").trim().toLowerCase();
      const ownerT = (l.hubspot_owner_id && ownerTeam.get(l.hubspot_owner_id) || "").toLowerCase();
      const pick = t.team.toLowerCase();
      if (div !== pick && ownerT !== pick) return false;
    }
    return true;
  }

  function render() {
    const q = __trackState.q.trim();
    // Show ALL leads by default, then apply team/date/search filters.
    // Sort by date desc so the most recent leads surface first.
    let hits = all.filter(inWindow);
    if (q) hits = hits.filter(l => matches(l, q));
    hits.sort((a, b) => (b.datestamp || "").localeCompare(a.datestamp || ""));
    const cap = 200;
    const activeFilters = [
      q                ? `matching "${q}"`               : null,
      __trackState.team? `team = ${__trackState.team}`   : null,
      __trackState.from? `from ${__trackState.from}`     : null,
      __trackState.to  ? `to ${__trackState.to}`         : null,
    ].filter(Boolean);

    root.innerHTML = `
      <h2>Track a lead</h2>
      <p class="lede">
        Every lead, labelled <strong>date · address · source · HubSpot stage</strong>. Filter by
        team + date range or search any part of address / name / phone / email / deal ID. Click a
        row to expand the full trace.
      </p>

      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; margin-bottom:14px;">
        <label style="flex:1 1 240px; min-width:220px;">
          <div class="muted small" style="margin-bottom:4px;">Search</div>
          <input class="search" id="track-search" type="text"
                 placeholder='"36 Birkenhead", "Meta", 082…, promqueens@…, 78123456'
                 value="${escapeAttr(q)}"
                 autofocus
                 style="width:100%;">
        </label>
        <label style="flex:0 0 200px;">
          <div class="muted small" style="margin-bottom:4px;">Team</div>
          <select id="track-team" style="width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:8px; font: inherit;">
            <option value="">All teams</option>
            ${teams.map(t => `<option value="${escapeAttr(t)}"${__trackState.team === t ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}
          </select>
        </label>
        <label style="flex:0 0 150px;">
          <div class="muted small" style="margin-bottom:4px;">From</div>
          <input id="track-from" type="date" value="${escapeAttr(__trackState.from)}"
                 style="width:100%; padding:7px 10px; border:1px solid var(--line); border-radius:8px; font: inherit;">
        </label>
        <label style="flex:0 0 150px;">
          <div class="muted small" style="margin-bottom:4px;">To</div>
          <input id="track-to" type="date" value="${escapeAttr(__trackState.to)}"
                 style="width:100%; padding:7px 10px; border:1px solid var(--line); border-radius:8px; font: inherit;">
        </label>
        <button id="track-clear" class="btn-ghost"
                style="padding:8px 14px; align-self:flex-end;${activeFilters.length ? '' : ' opacity:0.5;'}"
                ${activeFilters.length ? '' : 'disabled'}>Clear</button>
      </div>

      <p class="muted small">
        <strong>${hits.length.toLocaleString()}</strong> lead${hits.length === 1 ? "" : "s"}
        ${activeFilters.length ? ` · ${activeFilters.map(escapeHtml).join(" · ")}` : ""}
        ${hits.length > cap ? ` · showing most recent ${cap.toLocaleString()}` : ""}
      </p>

      ${hits.length === 0
        ? `<p class="muted">No leads match your filters. Widen the date range or clear the team pick.</p>`
        : `<div style="display:flex; flex-direction:column; gap:8px; margin-top:8px;">
             ${hits.slice(0, cap).map(rowCard).join("")}
           </div>`
      }
    `;

    const inp = document.getElementById("track-search");
    // Preserve caret across re-renders so typing feels continuous.
    inp.addEventListener("input", e => {
      const caret = e.target.selectionStart;
      __trackState.q = e.target.value;
      render();
      const s2 = document.getElementById("track-search");
      if (s2) {
        s2.focus();
        try { s2.setSelectionRange(caret, caret); } catch (_) {}
      }
    });

    document.getElementById("track-team").addEventListener("change", e => {
      __trackState.team = e.target.value;
      render();
    });
    document.getElementById("track-from").addEventListener("change", e => {
      __trackState.from = e.target.value;
      render();
    });
    document.getElementById("track-to").addEventListener("change", e => {
      __trackState.to = e.target.value;
      render();
    });
    const clearBtn = document.getElementById("track-clear");
    if (clearBtn) clearBtn.addEventListener("click", () => {
      __trackState = { q: "", expanded: null, team: "", from: "", to: "" };
      render();
    });

    root.querySelectorAll("[data-toggle-email]").forEach(el => {
      el.addEventListener("click", () => {
        const em = el.dataset.toggleEmail;
        __trackState.expanded = (__trackState.expanded === em) ? null : em;
        render();
      });
    });
  }

  function rowCard(l) {
    const expanded = __trackState.expanded === l.email;
    const stage = l.current_stage || (l.deal_id ? "Unknown stage" : "No HubSpot deal");
    const tone = _stageTone(l.current_stage);
    const ownerId = l.hubspot_owner_id || "";
    const ownerTeamName = ownerId ? (ownerTeam.get(ownerId) || "Unmapped owner") : "";

    // Address is the primary label; falls back to client name if the sheet
    // row has no address (rare — inbound-call leads).
    const primary = l.property_address
      ? l.property_address + (l.suburb ? `, ${l.suburb}` : "")
      : (l.client_name || l.email || "(no address)");

    const dateShort = l.datestamp
      ? new Date(l.datestamp).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })
      : "";

    const header = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div style="min-width:0; flex:1; display:flex; align-items:center; gap:12px;">
          ${dateShort
            ? `<div class="muted small tnum" style="flex:0 0 auto; font-variant-numeric:tabular-nums; min-width:70px;">${escapeHtml(dateShort)}</div>`
            : ""}
          <div style="min-width:0; flex:1;">
            <div style="font-weight:600; font-size:14px; color:var(--ink);">
              ${escapeHtml(primary)}
            </div>
            ${l.property_address && l.client_name
              ? `<div class="muted small" style="margin-top:2px;">${escapeHtml(l.client_name)}</div>`
              : ""}
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          ${l.source ? `<span class="pill">${escapeHtml(l.source)}</span>` : `<span class="pill" style="background:#EEF2F8;color:var(--slate);">no source</span>`}
          <span class="pill ${tone === "muted" ? "" : tone}">${escapeHtml(stage)}</span>
        </div>
      </div>
    `;

    if (!expanded) {
      return `
        <div class="card" data-toggle-email="${escapeAttr(l.email)}"
             style="cursor:pointer; padding:14px 16px;">
          ${header}
        </div>
      `;
    }

    // Expanded detail: sheet → HubSpot chain
    const rows = [
      ["Arrived on sheet",    fmtDate(l.datestamp) + (l.datestamp ? ` (${humanAgo(new Date(l.datestamp))})` : "")],
      ["Source",              l.source || "—"],
      ["Client name",         l.client_name || "—"],
      ["Email",               l.email || "—"],
      ["Phone",               l.phone || "—"],
      ["Property address",    l.property_address || "—"],
      ["Suburb",              l.suburb || "—"],
      ["Property type",       l.property_type || "—"],
      ["Sheet division",      l.division || "—"],
      ["Lead type",           l.is_lead || "—"],
      ["Timeline (sheet)",    l.timeline || "—"],
      ["Relationship",        l.relationship || "—"],
      null, // separator
      ["HubSpot deal ID",     l.deal_id
        ? `<a href="${_hsDealLink(l.deal_id)}" target="_blank" rel="noopener">${escapeHtml(l.deal_id)} ↗</a>`
        : "(none)"],
      ["Deal name",           l.deal_name || "—"],
      ["Current stage",       l.current_stage
        ? `<span class="pill ${tone === "muted" ? "" : tone}">${escapeHtml(l.current_stage)}</span>`
        : "—"],
      ["Amount",              l.amount ? "R" + Number(l.amount).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"],
      ["Expected close",      fmtShortDate(l.close_date) || "—"],
      ["HubSpot owner",       ownerId
        ? `<a href="${_hsOwnerLink(ownerId)}" target="_blank" rel="noopener">${escapeHtml(ownerId)} ↗</a>
           ${ownerTeamName ? ` <span class="muted small">→ ${escapeHtml(ownerTeamName)}</span>` : ""}`
        : "—"],
      ["Calls logged",        (l.num_calls || 0).toString() + (l.worked ? " · Worked" : " · Not yet worked")],
      ["Last HubSpot change", l.hs_last_modified ? `${fmtDate(l.hs_last_modified)} (${humanAgo(new Date(l.hs_last_modified))})` : "—"],
    ];

    const table = rows.map(r => {
      if (r === null) return `<tr><td colspan="2" style="padding:8px 0;"><hr style="border:none; border-top:1px solid var(--line); margin:0;"></td></tr>`;
      return `<tr>
        <td class="muted" style="padding:6px 12px 6px 0; vertical-align:top; width:170px;">${escapeHtml(r[0])}</td>
        <td style="padding:6px 0; vertical-align:top;">${r[1]}</td>
      </tr>`;
    }).join("");

    const noteBlock = l.action_note
      ? `<div style="margin-top:14px; padding:12px 14px; background:var(--paper); border-left:3px solid var(--yellow); border-radius:4px;">
          <div class="muted small" style="text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">Note from ${escapeHtml(l.note_by || "team")}${l.note_at ? " · " + fmtDate(l.note_at) : ""}</div>
          <div>${escapeHtml(l.action_note)}</div>
        </div>`
      : "";

    return `
      <div class="card" style="padding:16px 20px;">
        <div data-toggle-email="${escapeAttr(l.email)}" style="cursor:pointer;">${header}</div>
        <table style="width:100%; margin-top:14px; font-size:13px; border-collapse:collapse;">
          <tbody>${table}</tbody>
        </table>
        ${noteBlock}
      </div>
    `;
  }

  render();
};
