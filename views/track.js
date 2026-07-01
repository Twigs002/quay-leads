// Track — search any single lead and see exactly where it landed in
// HubSpot. Type an address, name, phone, email, or deal ID and get the
// full trace: sheet arrival → division/team it went to → HubSpot deal
// owner → current stage → calls → notes → last activity.
window.VIEWS = window.VIEWS || {};

// Persist state across renders (search term, expanded row) within a session.
let __trackState = { q: "", expanded: null };

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

  function render() {
    const q = __trackState.q.trim();
    const hits = q ? all.filter(l => matches(l, q)) : [];

    root.innerHTML = `
      <h2>Track a lead</h2>
      <p class="lede">
        Type any part of a lead's <strong>address</strong>, <strong>name</strong>, <strong>phone</strong>,
        <strong>email</strong>, or <strong>HubSpot deal ID</strong> to trace exactly where it landed —
        which division picked it up, which HubSpot owner it sits under, its current stage, and every
        note logged against it.
      </p>

      <input class="search" id="track-search" type="text"
             placeholder='e.g. "36 Birkenhead", "Meta", "0821234567", promqueens@…, 78123456'
             value="${escapeAttr(q)}"
             autofocus
             style="width:100%; max-width:640px; margin-bottom:12px;">

      ${!q
        ? `<p class="muted">Start typing to search across ${all.length.toLocaleString()} leads.</p>`
        : hits.length === 0
          ? `<p class="muted">No leads match <strong>${escapeHtml(q)}</strong>. Try a shorter fragment (e.g. street name only, or first 3 digits of the phone).</p>`
          : `<p class="muted small"><strong>${hits.length.toLocaleString()}</strong> match${hits.length === 1 ? "" : "es"} · click any card to expand.</p>
             <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
               ${hits.slice(0, 50).map(rowCard).join("")}
             </div>
             ${hits.length > 50 ? `<p class="muted small" style="margin-top:12px;">Showing first 50 of ${hits.length.toLocaleString()}. Narrow the search to see more.</p>` : ""}`
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

    const header = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div style="min-width:0;">
          <div style="font-weight:700; font-size:15px; color:var(--ink);">
            ${escapeHtml(l.client_name || l.email || "(no name)")}
          </div>
          <div class="muted small" style="margin-top:2px;">
            ${escapeHtml(l.property_address || "")}${l.suburb ? " · " + escapeHtml(l.suburb) : ""}
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          ${l.source ? `<span class="pill">${escapeHtml(l.source)}</span>` : ""}
          <span class="pill ${tone === "muted" ? "" : tone}">${escapeHtml(stage)}</span>
          ${l.division ? `<span class="pill" style="background:#FDC503;color:#1A2746;">${escapeHtml(l.division)}</span>` : ""}
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
