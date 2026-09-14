// Track — search any single lead and see exactly where it landed in
// HubSpot. Type an address, name, phone, email, or deal ID and get the
// full trace: sheet arrival → division/team it went to → HubSpot deal
// owner → current stage → calls → notes → last activity.
window.VIEWS = window.VIEWS || {};

// Persist state across renders (search term, expanded row) within a session.
let __trackState = { q: "", expanded: null, team: "", from: "", to: "" };

// ── Lead economics panel ───────────────────────────────────────────────
// A cost layer on top of the Track view: what a qualified lead costs us, per
// source, over the date range the view already uses. Kept module-scoped so a
// search keystroke (which re-renders the whole view) never resets the picked
// source or the qualified-stage checkboxes. Cost-per-lead values live in
// localStorage so they survive a reload. All money is ZAR, R prefix, spaced
// thousands, rounded for display only. No em or en dashes anywhere here.
const __ECON_COST_LS = "quayLeads.leadEconCostPerLead.v1";
let __econState = { source: null, stages: null };   // stages: Set, null = not built

function _econLoadCosts() {
  try {
    const m = JSON.parse(localStorage.getItem(__ECON_COST_LS));
    return (m && typeof m === "object") ? m : {};
  } catch (_) { return {}; }
}
function _econSaveCost(key, val) {
  const m = _econLoadCosts();
  if (val === null || val === "" || !Number.isFinite(val)) delete m[key];
  else m[key] = val;
  try { localStorage.setItem(__ECON_COST_LS, JSON.stringify(m)); } catch (_) {}
}
function _econCostOf(key) {
  const v = _econLoadCosts()[key];
  return Number.isFinite(v) ? v : null;
}
// "R13 840" style: R prefix, space thousands separator, no decimals.
function _econRand(v) {
  const n = Math.round(Number(v) || 0);
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return "R" + (n < 0 ? "-" + s : s);
}
// Which paid channel a lead belongs to. Same taxonomy the Lead economics view
// uses (originFor): the calling pipe (auto) is Dialfire, a Meta / Facebook / fb
// source is Meta, everything else is the Seller Lead Bank sheet book.
function _econChannel(l) {
  if (l && l.deal_creation === "auto") return "Dialfire";
  if (l && STAGES.isMetaSource(l.source)) return "Meta / Facebook";
  return "Seller Lead Bank";
}

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

// HubSpot deep links live in UTILS (one canonical portal id). Thin local
// wrappers keep the call sites below unchanged.
const _hsDealLink = (dealId) => UTILS.hsDealLink(dealId);
const _hsOwnerLink = (ownerId) => UTILS.hsOwnerLink(ownerId);

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

  // ── Lead economics: source channels + qualified-stage set ─────────────
  // Seed Meta at R80 the very first time only; after that the director owns
  // every figure (clearing a value sticks, we never re-seed over it).
  if (localStorage.getItem(__ECON_COST_LS) === null) {
    _econSaveCost("Meta / Facebook", STAGES.META_COST_PER_LEAD);
  }
  // Channels actually present in the book, in a stable, meaningful order.
  const ECON_CHANNEL_ORDER = ["Meta / Facebook", "Dialfire", "Seller Lead Bank"];
  const econChannels = (() => {
    const seen = new Set();
    for (const l of all) seen.add(_econChannel(l));
    const ordered = ECON_CHANNEL_ORDER.filter(c => seen.has(c));
    for (const c of seen) if (!ordered.includes(c)) ordered.push(c);
    return ordered;
  })();
  // Deal stages present across the whole book, in HubSpot pipeline order. This
  // is the qualification list; every box starts checked.
  const econStages = (() => {
    const seen = new Set();
    for (const l of all) if (l.has_deal) seen.add(l.current_stage || "Unknown stage");
    return [...seen].sort((a, b) => STAGES.orderIndex(a) - STAGES.orderIndex(b));
  })();
  if (__econState.stages === null) __econState.stages = new Set(econStages);
  if (!__econState.source || !econChannels.includes(__econState.source)) {
    __econState.source = econChannels.includes("Meta / Facebook")
      ? "Meta / Facebook" : (econChannels[0] || null);
  }

  // Economics respects the source pick + the SAME date range as the matching
  // view below, and nothing else (not the team pick, not the text search).
  function econInRange(l) {
    const t = __trackState;
    if (t.from && (!l.datestamp || l.datestamp.slice(0, 10) < t.from)) return false;
    if (t.to   && (!l.datestamp || l.datestamp.slice(0, 10) > t.to))   return false;
    return true;
  }

  // Pure calculation for one channel + a set of checked (qualifying) stages.
  // Total spend uses the LEAD count and never depends on the checkboxes; only
  // qualified deals (the denominator) move when a stage is toggled.
  function econCompute(channel, checked) {
    const inChannel = all.filter(l => _econChannel(l) === channel && econInRange(l));
    const leads = inChannel.length;
    const deals = inChannel.filter(l => l.has_deal);
    let qualified = 0;
    for (const d of deals) if (checked.has(d.current_stage || "Unknown stage")) qualified++;
    const cost = _econCostOf(channel);
    const spend = cost == null ? null : leads * cost;
    const cpq = (cost == null || qualified === 0) ? null : spend / qualified;   // divide raw, round only on display
    return { leads, totalDeals: deals.length, qualified, cost, spend, cpq };
  }

  function econPanelHtml() {
    const ch = __econState.source;
    const e = econCompute(ch, __econState.stages);
    const dash = "-";
    const spendStr = e.cost == null ? dash : _econRand(e.spend);
    const cplStr   = e.cost == null ? dash : _econRand(e.cost);
    const cpqStr   = e.cpq  == null ? dash : _econRand(e.cpq);
    const spendSub = e.cost == null
      ? `${e.leads.toLocaleString()} lead${e.leads === 1 ? "" : "s"} · enter a cost per lead below`
      : `${e.leads.toLocaleString()} lead${e.leads === 1 ? "" : "s"} x ${_econRand(e.cost)}`;
    const cpqSub = `${e.qualified.toLocaleString()} qualified of ${e.totalDeals.toLocaleString()} deal${e.totalDeals === 1 ? "" : "s"}`;

    const sourceOpts = econChannels
      .map(c => `<option value="${escapeAttr(c)}"${c === ch ? " selected" : ""}>${escapeHtml(c)}</option>`)
      .join("");
    const costs = _econLoadCosts();
    const costRows = econChannels.map(c => {
      const cv = Number.isFinite(costs[c]) ? costs[c] : "";
      return `<label style="display:flex; align-items:center; gap:8px; font-size:13px;">
        <span class="muted" style="flex:0 0 auto;">R</span>
        <input type="text" inputmode="numeric" data-econ-cost="${escapeAttr(c)}" value="${escapeAttr(String(cv))}"
               placeholder="enter"
               style="width:96px; padding:6px 8px; border:1px solid var(--line); border-radius:8px; font:inherit; text-align:right; font-variant-numeric:tabular-nums;">
        <span>${escapeHtml(c)}</span>
      </label>`;
    }).join("");
    const stageRows = econStages.map(s => {
      const on = __econState.stages.has(s);
      return `<label style="display:flex; align-items:center; gap:6px; font-size:13px;">
        <input type="checkbox" data-econ-stage="${escapeAttr(s)}"${on ? " checked" : ""}>
        <span>${escapeHtml(s)}</span>
      </label>`;
    }).join("");

    return `
      <section class="card" style="padding:16px 20px; margin-bottom:16px;">
        <h2 style="margin:0 0 4px;">Lead economics</h2>
        <p class="section-caption" style="margin-top:0;">
          What a qualified lead costs us, per source, over the date range set with the From and To fields below.
          Total spend is leads x cost per lead and does not move when you change the qualified stages, only the
          cost per qualified lead does.
        </p>

        <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end; margin:10px 0 14px;">
          <label style="flex:0 0 240px; min-width:220px;">
            <div class="muted small" style="margin-bottom:4px;">Source</div>
            <select id="econ-source" style="width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:8px; font:inherit;">
              ${sourceOpts}
            </select>
          </label>
          <div class="muted small" style="padding-bottom:9px;">Date range: set with the From and To fields below.</div>
        </div>

        <div class="kpis" style="margin-top:4px;">
          <div class="kpi" style="border-left:4px solid var(--slate);">
            <div class="label">Total spend</div>
            <div class="value" id="econ-spend">${spendStr}</div>
            <div class="delta-row muted small" id="econ-spend-sub">${escapeHtml(spendSub)}</div>
          </div>
          <div class="kpi">
            <div class="label">Cost per lead</div>
            <div class="value" id="econ-cpl">${cplStr}</div>
            <div class="delta-row muted small" id="econ-cpl-sub">${escapeHtml(ch || "")}</div>
          </div>
          <div class="kpi" style="border-left:4px solid var(--yellow);">
            <div class="label">Cost per qualified lead</div>
            <div class="value" id="econ-cpq">${cpqStr}</div>
            <div class="delta-row muted small" id="econ-cpq-sub">${escapeHtml(cpqSub)}</div>
          </div>
        </div>

        <div style="display:flex; gap:28px; flex-wrap:wrap; margin-top:18px;">
          <div style="flex:1 1 260px; min-width:240px;">
            <div class="muted small" style="text-transform:uppercase; letter-spacing:0.04em; margin-bottom:8px;">
              Cost per lead by source (ZAR, saved on this device)
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">${costRows}</div>
          </div>
          <div style="flex:1 1 260px; min-width:240px;">
            <div class="muted small" style="text-transform:uppercase; letter-spacing:0.04em; margin-bottom:8px;">
              Stages that count as qualified
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 16px;">${stageRows}</div>
          </div>
        </div>
      </section>
    `;
  }

  function econRecalc() {
    const e = econCompute(__econState.source, __econState.stages);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const dash = "-";
    set("econ-spend", e.cost == null ? dash : _econRand(e.spend));
    set("econ-cpl",   e.cost == null ? dash : _econRand(e.cost));
    set("econ-cpq",   e.cpq  == null ? dash : _econRand(e.cpq));
    set("econ-spend-sub", e.cost == null
      ? `${e.leads.toLocaleString()} lead${e.leads === 1 ? "" : "s"} · enter a cost per lead below`
      : `${e.leads.toLocaleString()} lead${e.leads === 1 ? "" : "s"} x ${_econRand(e.cost)}`);
    set("econ-cpl-sub", __econState.source || "");
    set("econ-cpq-sub", `${e.qualified.toLocaleString()} qualified of ${e.totalDeals.toLocaleString()} deal${e.totalDeals === 1 ? "" : "s"}`);
  }

  function econWire() {
    const sel = document.getElementById("econ-source");
    if (sel) sel.addEventListener("change", () => { __econState.source = sel.value; econRecalc(); });
    root.querySelectorAll("[data-econ-cost]").forEach(inp => {
      inp.addEventListener("input", () => {
        const raw = inp.value.replace(/[^\d]/g, "");   // digits only; blank = cleared
        if (raw !== inp.value) inp.value = raw;
        _econSaveCost(inp.dataset.econCost, raw === "" ? null : Number(raw));
        econRecalc();
      });
    });
    root.querySelectorAll("[data-econ-stage]").forEach(cb => {
      cb.addEventListener("change", () => {
        const st = cb.dataset.econStage;
        if (cb.checked) __econState.stages.add(st); else __econState.stages.delete(st);
        econRecalc();
      });
    });
  }

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
      ${econPanelHtml()}
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

    // Wire the lead economics panel (source pick, per-source cost inputs,
    // qualified-stage checkboxes). Toggles recalc figures live, no re-render.
    econWire();

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
        <td class="muted" style="padding:6px 12px 6px 0; vertical-align:top; width:40%; max-width:170px;">${escapeHtml(r[0])}</td>
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
