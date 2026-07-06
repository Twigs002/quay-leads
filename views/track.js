// Track — search any single lead and see exactly where it landed in
// HubSpot. Type an address, name, phone, email, or deal ID and get the
// full trace: sheet arrival → division/team it went to → HubSpot deal
// owner → current stage → calls → notes → last activity.
window.VIEWS = window.VIEWS || {};

// Persist state across renders (search term, expanded row) within a session.
let __trackState = { q: "", expanded: null, team: "", from: "", to: "" };

// Per-deal call history, populated lazily when a row expands. Keyed by
// deal_id → { status: "loading" | "ready" | "error", rows: [...], error: "" }.
// Kept module-scoped so re-renders (search, filter tweaks) don't refetch.
const __callHistory = new Map();

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

// Format seconds as m:ss (or "—" if null/0-but-really-null). Zero-second
// calls do occur — HubSpot logs voicemail leaves at 0s — so we DO render 0:00.
function _fmtDuration(sec) {
  if (sec === null || sec === undefined) return "—";
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return "—";
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// HubSpot dispositions come back as an internal UUID rather than a label
// (the label lookup lives in a separate settings endpoint). Show the raw
// value truncated so a caller at least sees SOMETHING is set. Falls back
// to em-dash for null.
function _shortDisposition(d) {
  if (!d) return "—";
  const s = String(d);
  return s.length > 12 ? s.slice(0, 8) + "…" : s;
}

function _dirBadge(dir) {
  const d = (dir || "").toUpperCase();
  if (d === "INBOUND")  return `<span class="pill" style="background:#E7F5EC;color:#0F6E3B;">In</span>`;
  if (d === "OUTBOUND") return `<span class="pill" style="background:#EEF2F8;color:var(--slate);">Out</span>`;
  return `<span class="pill" style="background:#F5F5F5;color:var(--slate);">—</span>`;
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
        const dealId = el.dataset.dealId || "";
        __trackState.expanded = (__trackState.expanded === em) ? null : em;
        // Kick off the call-history fetch the first time this deal expands.
        // Subsequent expansions reuse the cache. Deals without a deal_id
        // (retry / action-needed leads) skip this entirely.
        if (__trackState.expanded === em && dealId && !__callHistory.has(dealId)) {
          __callHistory.set(dealId, { status: "loading", rows: [], error: "" });
          DATA.getDealCalls(dealId).then(rows => {
            __callHistory.set(dealId, { status: "ready", rows, error: "" });
            // Only re-render if this row is still the expanded one — user
            // may have clicked away by the time the promise resolves.
            if (__trackState.expanded === em) render();
          }).catch(err => {
            __callHistory.set(dealId, {
              status: "error", rows: [], error: String(err && err.message || err),
            });
            if (__trackState.expanded === em) render();
          });
        }
        render();
      });
    });
  }

  function renderCallHistory(dealId) {
    if (!dealId) {
      return `<div class="muted small" style="margin-top:14px;">No HubSpot deal — no call history to show.</div>`;
    }
    const state = __callHistory.get(dealId);
    if (!state || state.status === "loading") {
      return `<div class="muted small" style="margin-top:14px;">Loading call history…</div>`;
    }
    if (state.status === "error") {
      return `<div class="muted small" style="margin-top:14px; color:var(--red, #b00);">
        Couldn't load calls: ${escapeHtml(state.error || "unknown error")}
      </div>`;
    }
    const rows = state.rows || [];
    if (rows.length === 0) {
      return `<div class="muted small" style="margin-top:14px;">No calls logged against this deal yet.</div>`;
    }
    const header = `
      <thead>
        <tr>
          <th style="text-align:left; padding:6px 10px 6px 0; font-weight:600; color:var(--slate); white-space:nowrap;">When</th>
          <th style="text-align:left; padding:6px 10px; font-weight:600; color:var(--slate);">Dir</th>
          <th style="text-align:right; padding:6px 10px; font-weight:600; color:var(--slate); white-space:nowrap;">Duration</th>
          <th style="text-align:left; padding:6px 10px; font-weight:600; color:var(--slate);">Disposition</th>
          <th style="text-align:left; padding:6px 10px; font-weight:600; color:var(--slate);">Agent</th>
          <th style="text-align:left; padding:6px 0 6px 10px; font-weight:600; color:var(--slate);">Notes</th>
        </tr>
      </thead>
    `;
    const body = rows.map(r => {
      const when = r.ts ? fmtDate(r.ts) : "—";
      const agent = r.hubspot_owner_id
        ? `<a href="${_hsOwnerLink(r.hubspot_owner_id)}" target="_blank" rel="noopener">${escapeHtml(r.hubspot_owner_id)}</a>`
        : "—";
      const notes = r.notes ? escapeHtml(r.notes) : `<span class="muted">—</span>`;
      return `<tr style="border-top:1px solid var(--line);">
        <td style="padding:8px 10px 8px 0; vertical-align:top; white-space:nowrap; font-variant-numeric:tabular-nums;">${escapeHtml(when)}</td>
        <td style="padding:8px 10px; vertical-align:top;">${_dirBadge(r.direction)}</td>
        <td style="padding:8px 10px; vertical-align:top; text-align:right; font-variant-numeric:tabular-nums;">${escapeHtml(_fmtDuration(r.duration_sec))}</td>
        <td style="padding:8px 10px; vertical-align:top;">${escapeHtml(_shortDisposition(r.disposition))}</td>
        <td style="padding:8px 10px; vertical-align:top;">${agent}</td>
        <td style="padding:8px 0 8px 10px; vertical-align:top; max-width:340px;">${notes}</td>
      </tr>`;
    }).join("");
    return `
      <div style="margin-top:16px;">
        <div class="muted small" style="text-transform:uppercase; letter-spacing:0.04em; margin-bottom:6px;">
          Call history · ${rows.length} call${rows.length === 1 ? "" : "s"} (most recent first)
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%; font-size:12.5px; border-collapse:collapse;">
            ${header}
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>
    `;
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

    // Chevron makes it obvious the row is expandable. Rotates on expand.
    const chev = `<span class="muted" style="flex:0 0 auto; font-size:11px; line-height:1;
      display:inline-block; width:14px; text-align:center;
      transform:${expanded ? "rotate(90deg)" : "rotate(0deg)"};
      transition:transform 0.15s ease;">▶</span>`;
    const callChip = l.num_calls > 0
      ? `<span class="pill" style="background:#EEF2F8; color:var(--slate);">${l.num_calls} call${l.num_calls === 1 ? "" : "s"}</span>`
      : "";

    const header = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div style="min-width:0; flex:1; display:flex; align-items:center; gap:12px;">
          ${chev}
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
          ${callChip}
          ${l.source ? `<span class="pill">${escapeHtml(l.source)}</span>` : `<span class="pill" style="background:#EEF2F8;color:var(--slate);">no source</span>`}
          <span class="pill ${tone === "muted" ? "" : tone}">${escapeHtml(stage)}</span>
        </div>
      </div>
    `;

    if (!expanded) {
      return `
        <div class="card" data-toggle-email="${escapeAttr(l.email)}"
             data-deal-id="${escapeAttr(l.deal_id || "")}"
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
        <div data-toggle-email="${escapeAttr(l.email)}"
             data-deal-id="${escapeAttr(l.deal_id || "")}"
             style="cursor:pointer;">${header}</div>
        <table style="width:100%; margin-top:14px; font-size:13px; border-collapse:collapse;">
          <tbody>${table}</tbody>
        </table>
        ${noteBlock}
        ${renderCallHistory(l.deal_id || "")}
      </div>
    `;
  }

  render();
};
