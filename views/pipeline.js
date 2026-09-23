// Pipeline view — funnel + live stage bar + division leaderboard + per-division breakdown.
window.VIEWS = window.VIEWS || {};

// ── Lead economics panel ───────────────────────────────────────────────
// A cost layer on the Pipeline view: what a qualified lead costs us, per
// source, over the sidebar date range and filters. Cost-per-lead values live
// in localStorage so they survive a reload; the qualified-stage checkboxes are
// module-scoped so a filter re-render never resets them (the panel follows the
// sidebar source filter - no source picker). All money is ZAR, R prefix,
// spaced thousands, rounded for
// display only. No em or en dashes anywhere here.
const __ECON_COST_LS = "quayLeads.leadEconCostPerLead.v1";
let __econState = { stages: null };   // stages: Set, null = not built (no source picker; the panel follows the sidebar source filter)

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
// "R13 840" style: R prefix, space thousands separator, no decimals.
function _econRand(v) {
  const n = Math.round(Number(v) || 0);
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return "R" + (n < 0 ? "-" + s : s);
}
// Which paid channel a lead belongs to, by ACQUISITION SOURCE. A Meta / Facebook
// / fb source is Meta - what we paid to acquire the lead - regardless of who
// later created the HubSpot deal (the Dialfire -> n8n pipe often auto-creates the
// deal for a Meta lead, but we still paid Meta to get the lead). Only a lead that
// is NOT a Meta source and whose deal was auto-created belongs to the Dialfire
// calling pipe; everything else is the Seller Lead Bank sheet book.
function _econChannel(l) {
  if (l && STAGES.isMetaSource(l.source)) return "Meta / Facebook";
  if (l && l.deal_creation === "auto") return "Dialfire";
  return "Seller Lead Bank";
}
window.VIEWS.pipeline = function (root, ctx) {
  const leads = ctx.view.leads;
  const { escapeHtml, escapeAttr, emptyState } = UTILS;
  if (!leads.length) {
    root.innerHTML = `<h2>Pipeline</h2>${emptyState()}`;
    return;
  }

  // ── Lead economics: source channels + qualified-stage set ─────────────
  // Options are built from the whole book (ctx.cache.leads) so a source or a
  // stage never disappears when the sidebar filters narrow things. The figures
  // themselves are computed over the filtered view (leads = ctx.view.leads), so
  // the panel moves with the sidebar date range and filters.
  const allBook = (ctx.cache && ctx.cache.leads) || leads;
  // Seed Meta at R80 the very first time only; after that the director owns
  // every figure (clearing a value sticks, we never re-seed over it).
  if (localStorage.getItem(__ECON_COST_LS) === null) {
    _econSaveCost("Meta / Facebook", STAGES.META_COST_PER_LEAD);
  }
  const ECON_CHANNEL_ORDER = ["Meta / Facebook", "Dialfire", "Seller Lead Bank"];
  const econChannels = (() => {
    const seen = new Set();
    for (const l of allBook) seen.add(_econChannel(l));
    const ordered = ECON_CHANNEL_ORDER.filter(c => seen.has(c));
    for (const c of seen) if (!ordered.includes(c)) ordered.push(c);
    return ordered;
  })();
  const econStages = (() => {
    const seen = new Set();
    for (const l of allBook) {
      if (!l.has_deal) continue;
      const s = l.current_stage || "Unknown stage";
      if (STAGES.isHidden(s)) continue;   // junk/placeholder stages never qualify
      seen.add(s);
    }
    return [...seen].sort((a, b) => STAGES.orderIndex(a) - STAGES.orderIndex(b));
  })();
  // Default: everything qualifies except the "dead" stages (please delete,
  // Past Let - Leakage, Sold by Competitor) - see STAGES.isQualified. The
  // director can still tick those back on; the box just starts on the rule.
  if (__econState.stages === null) __econState.stages = new Set(econStages.filter(STAGES.isQualified));

  // Pure calculation over the currently filtered leads, which already respect
  // the sidebar source filter + date range (there is no source picker here -
  // the panel follows the sidebar). Total spend sums each deal's OWN source
  // cost per lead, so it is correct whether the view holds one source or many,
  // and never depends on the checkboxes, so it stays put as stages are toggled;
  // only the cost-per-deal denominator (selected deals) moves with the stage box.
  function econCompute(checked) {
    const deals = leads.filter(l => l.has_deal);
    const costs = _econLoadCosts();
    // Spend across ALL leads received (each lead x its own source cost per lead):
    // what we actually paid to acquire the leads. Deal-spend is the subset that
    // went to leads which became HubSpot deals.
    let spendAll = 0, costedLeads = 0;
    for (const l of leads) {
      const c = costs[_econChannel(l)];
      if (Number.isFinite(c)) { spendAll += c; costedLeads++; }
    }
    let spendDeals = 0, selectedDeals = 0, costedDeals = 0;
    for (const d of deals) {
      const c = costs[_econChannel(d)];
      if (Number.isFinite(c)) { spendDeals += c; costedDeals++; }
      if (checked.has(d.current_stage || "Unknown stage")) selectedDeals++;
    }
    const hasCost = costedLeads > 0;
    // Both cost-per figures divide the full acquisition spend (all leads). Cost
    // per lead spreads it over the leads; cost per deal spreads it over the deals
    // in the selected stages, so it moves as the director picks stages. Divide
    // raw, round only on display.
    const cpl = hasCost ? spendAll / costedLeads : null;                            // blended R per lead across sources in view
    const cpd = (!hasCost || selectedDeals === 0) ? null : spendAll / selectedDeals; // R per deal in the selected stages
    return {
      totalLeads: leads.length, totalDeals: deals.length,
      costedLeads, costedDeals, selectedDeals,
      spendAll:   hasCost ? spendAll : null,
      spendDeals: costedDeals > 0 ? spendDeals : null,
      cpl, cpd,
    };
  }

  // Total-spend sub-captions: prompt for a cost when none is set, flag when only
  // some rows in view have a costed source, else just the count in view.
  function econSpendAllSub(e) {
    if (e.spendAll == null) return `${e.totalLeads.toLocaleString()} lead${e.totalLeads === 1 ? "" : "s"} · enter a cost per lead below`;
    if (e.costedLeads < e.totalLeads) return `${e.costedLeads.toLocaleString()} of ${e.totalLeads.toLocaleString()} leads costed`;
    return `${e.totalLeads.toLocaleString()} lead${e.totalLeads === 1 ? "" : "s"} received`;
  }
  function econSpendDealsSub(e) {
    if (e.spendDeals == null) return `${e.totalDeals.toLocaleString()} deal${e.totalDeals === 1 ? "" : "s"} · enter a cost per lead below`;
    if (e.costedDeals < e.totalDeals) return `${e.costedDeals.toLocaleString()} of ${e.totalDeals.toLocaleString()} deals costed`;
    return `${e.totalDeals.toLocaleString()} deal${e.totalDeals === 1 ? "" : "s"} in view`;
  }
  // Cost-per-deal sub-caption: flag how many of the deals in view sit in the
  // selected stages (the denominator), else just the count in view.
  function econCpdSub(e) {
    if (e.selectedDeals < e.totalDeals) return `${e.selectedDeals.toLocaleString()} of ${e.totalDeals.toLocaleString()} deal${e.totalDeals === 1 ? "" : "s"} selected`;
    return `${e.totalDeals.toLocaleString()} deal${e.totalDeals === 1 ? "" : "s"} in view`;
  }

  function econPanelHtml() {
    const e = econCompute(__econState.stages);
    const dash = "-";
    const spendAllStr   = e.spendAll   == null ? dash : _econRand(e.spendAll);
    const spendDealsStr = e.spendDeals == null ? dash : _econRand(e.spendDeals);
    const cplStr   = e.cpl == null ? dash : _econRand(e.cpl);
    const cpdStr   = e.cpd == null ? dash : _econRand(e.cpd);
    const spendAllSub   = econSpendAllSub(e);
    const spendDealsSub = econSpendDealsSub(e);
    const cplSub = e.cpl == null ? "" : "blended across sources in view";
    const cpdSub = econCpdSub(e);

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
      <section class="card" style="padding:16px 20px;">
        <h3 style="margin:0 0 4px;">Lead economics</h3>
        <p class="section-caption" style="margin-top:0;">
          What our leads cost us over the current sidebar source, date range and filters.
          Total spend (all leads) is each lead x its source cost per lead; total spend (deals) is the
          subset spent on leads that became HubSpot deals. Cost per lead and cost per deal both divide
          the all-leads spend, by the leads in view and by the deals in the selected stages. Spend does
          not move when you change the stage selection, only the cost per deal does.
        </p>

        <div class="kpis" style="margin-top:4px;">
          <div class="kpi" style="border-left:4px solid var(--slate);">
            <div class="label">Total spend (all leads)</div>
            <div class="value" id="econ-spend-all">${spendAllStr}</div>
            <div class="delta-row muted small" id="econ-spend-all-sub">${escapeHtml(spendAllSub)}</div>
          </div>
          <div class="kpi" style="border-left:4px solid var(--blue);">
            <div class="label">Total spend (deals)</div>
            <div class="value" id="econ-spend-deals">${spendDealsStr}</div>
            <div class="delta-row muted small" id="econ-spend-deals-sub">${escapeHtml(spendDealsSub)}</div>
          </div>
          <div class="kpi">
            <div class="label">Cost per lead</div>
            <div class="value" id="econ-cpl">${cplStr}</div>
            <div class="delta-row muted small" id="econ-cpl-sub">${escapeHtml(cplSub)}</div>
          </div>
          <div class="kpi" style="border-left:4px solid var(--green);">
            <div class="label">Cost per deal</div>
            <div class="value" id="econ-cpd">${cpdStr}</div>
            <div class="delta-row muted small" id="econ-cpd-sub">${escapeHtml(cpdSub)}</div>
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
            <div style="display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-bottom:8px;">
              <div class="muted small" style="text-transform:uppercase; letter-spacing:0.04em;">
                Stages that count toward cost per deal
              </div>
              <div class="no-print" style="display:flex; gap:6px; flex:0 0 auto;">
                <button type="button" id="econ-stage-all" style="font:inherit; font-size:12px; padding:3px 9px; border:1px solid var(--line); border-radius:6px; background:transparent; color:inherit; cursor:pointer;">Select all</button>
                <button type="button" id="econ-stage-none" style="font:inherit; font-size:12px; padding:3px 9px; border:1px solid var(--line); border-radius:6px; background:transparent; color:inherit; cursor:pointer;">Clear</button>
              </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 16px;">${stageRows}</div>
          </div>
        </div>
      </section>
    `;
  }

  function econRecalc() {
    const e = econCompute(__econState.stages);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const dash = "-";
    set("econ-spend-all",   e.spendAll   == null ? dash : _econRand(e.spendAll));
    set("econ-spend-deals", e.spendDeals == null ? dash : _econRand(e.spendDeals));
    set("econ-cpl", e.cpl == null ? dash : _econRand(e.cpl));
    set("econ-cpd", e.cpd == null ? dash : _econRand(e.cpd));
    set("econ-spend-all-sub", econSpendAllSub(e));
    set("econ-spend-deals-sub", econSpendDealsSub(e));
    set("econ-cpl-sub", e.cpl == null ? "" : "blended across sources in view");
    set("econ-cpd-sub", econCpdSub(e));
  }

  function econWire() {
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
    // Bulk toggles for the qualified-stage box: set the whole set on/off, sync
    // the visible checkboxes, then recalc (spend stays put, only CPQ moves).
    const applyStageSet = (stages) => {
      __econState.stages = new Set(stages);
      root.querySelectorAll("[data-econ-stage]").forEach(cb => {
        cb.checked = __econState.stages.has(cb.dataset.econStage);
      });
      econRecalc();
    };
    const allBtn = document.getElementById("econ-stage-all");
    if (allBtn) allBtn.addEventListener("click", () => applyStageSet(econStages));
    const noneBtn = document.getElementById("econ-stage-none");
    if (noneBtn) noneBtn.addEventListener("click", () => applyStageSet([]));
  }

  // Funnel
  const nLeads = leads.length;
  const QUAL = new Set(["Seller Lead", "Owner", "Buyer Lead", "Rental Lead"]);
  const nQualified = leads.filter(l => QUAL.has(l.is_lead)).length;
  const nDeal = leads.filter(l => l.has_deal).length;
  const nWorked = leads.filter(l => l.worked).length;

  // Live stage bar — ordered to match the HubSpot pipeline (chronological),
  // not by volume, so it reads exactly like HubSpot. Each bar also carries
  // the average HubSpot win-probability % for that stage.
  const withDeal = leads.filter(l => l.has_deal && l.current_stage);
  const byStage = {};
  const probSum = {}, probN = {};
  for (const l of withDeal) {
    byStage[l.current_stage] = (byStage[l.current_stage] || 0) + 1;
    if (l.probability != null && !isNaN(l.probability)) {
      probSum[l.current_stage] = (probSum[l.current_stage] || 0) + l.probability;
      probN[l.current_stage]   = (probN[l.current_stage]   || 0) + 1;
    }
  }
  const stageRows = Object.entries(byStage)
    .sort((a, b) => STAGES.orderIndex(a[0]) - STAGES.orderIndex(b[0]));
  const stageCmap = THEME.stageColors(stageRows.map(r => r[0]));
  const stagePct = (s) => probN[s] ? Math.round((probSum[s] / probN[s]) * 100) : null;

  // Sales outcomes (item: "sold by us" vs "lost to competitor").
  // Competitor-lost is the full set (Listed with Competitor + Sold by
  // Competitor), not just STAGES.LOST — otherwise "Sold by Competitor" deals are
  // dropped and the win rate reads higher than reality.
  const soldUs   = leads.filter(l => l.current_stage === STAGES.WON);
  const soldComp = leads.filter(l => STAGES.isLost(l.current_stage));
  const sumAmt   = arr => arr.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const soldUsVal = sumAmt(soldUs), soldCompVal = sumAmt(soldComp);
  const totalSold = soldUs.length + soldComp.length;
  const winRate   = totalSold ? (soldUs.length / totalSold * 100) : 0;
  const randMoney = v => v ? "R" + v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "R0";

  // Deal creation source (Option B): auto = the Dialfire→n8n pipe
  // (HubSpot record source n8n.cloud / INTEGRATION), manual = CRM UI. Backfilled
  // by the sync; until then deal_creation is null and this reads "awaiting sync".
  const dealLeads = withDeal;
  const creationKnown = dealLeads.some(l => l.deal_creation != null);
  const cAuto = dealLeads.filter(l => l.deal_creation === "auto").length;
  const cManual = dealLeads.filter(l => l.deal_creation === "manual").length;
  const cOther = dealLeads.filter(l => l.deal_creation === "other").length;
  const cPct = n => dealLeads.length ? Math.round(n / dealLeads.length * 100) + "%" : "0%";

  // Division leaderboard
  const board = {};
  for (const l of leads) {
    if (!l.division) continue;
    if (!board[l.division]) board[l.division] = { leads: 0, worked: 0, deals: 0 };
    board[l.division].leads++;
    if (l.worked) board[l.division].worked++;
    if (l.has_deal) board[l.division].deals++;
  }
  const boardRows = Object.entries(board).map(([k, v]) => ({
    div: k, ...v,
    workedPct: v.leads ? (v.worked / v.leads * 100) : 0,
    dealPct:   v.leads ? (v.deals / v.leads * 100) : 0,
  })).sort((a, b) => b.leads - a.leads);

  const topDivs = boardRows.slice(0, 15).map(r => r.div);

  // Per-division stage breakdown (stacked bar)
  const cellCounts = {};
  const stagesSeen = new Set();
  for (const l of leads) {
    if (!l.division || !topDivs.includes(l.division)) continue;
    const stage = (l.current_stage || "").trim() || "No deal yet";
    stagesSeen.add(stage);
    const k = `${l.division}|${stage}`;
    cellCounts[k] = (cellCounts[k] || 0) + 1;
  }
  // Chronological (HubSpot pipeline) order, with "No deal yet" pinned last.
  const stageOrder = [...stagesSeen]
    .filter(s => s !== "No deal yet")
    .sort((a, b) => STAGES.orderIndex(a) - STAGES.orderIndex(b))
    .concat(stagesSeen.has("No deal yet") ? ["No deal yet"] : []);
  const cmapDiv = THEME.stageColors(stageOrder);
  const divOrder = boardRows.slice(0, 15).slice().reverse().map(r => r.div);
  const breakdownTraces = stageOrder.map(stage => ({
    type: "bar", orientation: "h", name: stage,
    y: divOrder, x: divOrder.map(d => cellCounts[`${d}|${stage}`] || 0),
    marker: { color: cmapDiv[stage] },
  }));

  root.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
      <h2 style="margin:0;">Pipeline</h2>
      <button type="button" id="pipeline-export-pdf" class="btn-ghost no-print"
              title="Export this pipeline view as a PDF for the management team">⬇ Export PDF</button>
    </div>
    <p class="lede">How leads convert from inbound → qualified → deal → worked (call logged).</p>

    ${econPanelHtml()}

    <details class="card" id="meta-panel" style="padding: 0; margin-top:16px;">
      <summary style="cursor:pointer; list-style:none; padding:14px 16px; font-weight:700; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <span style="display:inline-flex; gap:3px;">
          <span style="display:inline-block;width:11px;height:11px;border-radius:2px;background:${THEME.PALETTE[0]};"></span>
          <span style="display:inline-block;width:11px;height:11px;border-radius:2px;background:${THEME.PALETTE[1]};"></span>
        </span>
        Meta channel — Facebook + Instagram
        <span class="muted small" style="font-weight:400;">FB &amp; IG performance for the current filter · click to expand</span>
      </summary>
      <div id="meta-block" style="padding:0 16px 16px;"></div>
    </details>

    <section class="card">
      <h3>Conversion funnel</h3>
      <div id="funnel-chart" style="height: 380px;"></div>
    </section>

    <section class="card">
      <h3>Where the deals are on HubSpot</h3>
      <p class="section-caption">Live deal stage from HubSpot, in pipeline order. Each bar shows the deal count and the stage's average <strong>win probability %</strong>. Refreshed every 30 min by the sync job. <strong>Click a bar</strong> to list that stage's deals with a link straight to each one in HubSpot.</p>
      <div id="stage-chart" style="height: 420px;"></div>
      <div id="stage-deals"></div>
    </section>

    <section class="card">
      <h3>Sales outcomes</h3>
      <p class="section-caption"><strong>Sold by us</strong> = deals in the <em>Sold</em> stage · <strong>Lost to competitor</strong> = <em>Listed with Competitor</em> or <em>Sold by Competitor</em>. Win rate = our sales ÷ all resolved outcomes.</p>
      <div class="kpis" style="margin-top: 4px;">
        <div class="kpi" style="border-left:4px solid ${THEME.tokens.green};">
          <div class="label">Sold by us</div>
          <div class="value">${soldUs.length.toLocaleString()}</div>
          <div class="delta-row muted small">${randMoney(soldUsVal)}</div>
        </div>
        <div class="kpi" style="border-left:4px solid #B91C1C;">
          <div class="label">Lost to competitor</div>
          <div class="value">${soldComp.length.toLocaleString()}</div>
          <div class="delta-row muted small">${randMoney(soldCompVal)}</div>
        </div>
        <div class="kpi">
          <div class="label">Win rate</div>
          <div class="value">${winRate.toFixed(0)}%</div>
          <div class="delta-row muted small">${totalSold.toLocaleString()} resolved</div>
        </div>
      </div>
    </section>

    <section class="card">
      <h3>How deals were created</h3>
      <p class="section-caption">
        <strong>Auto</strong> = created by the Dialfire → n8n pipe (HubSpot record source <code>n8n.cloud</code>).
        <strong>Manual</strong> = created by hand in the HubSpot UI. HubSpot has no dedicated "Dialfire" marker,
        so n8n is the proxy for the automated pipe. Over the ${dealLeads.length.toLocaleString()} deals in view.
      </p>
      ${creationKnown ? `
      <div class="kpis" style="margin-top: 4px;">
        <div class="kpi" style="border-left:4px solid ${THEME.tokens.blue};">
          <div class="label">Auto (n8n pipe)</div>
          <div class="value">${cAuto.toLocaleString()}</div>
          <div class="delta-row muted small">${cPct(cAuto)} of deals</div>
        </div>
        <div class="kpi" style="border-left:4px solid ${THEME.tokens.yellowDeep};">
          <div class="label">Manual (CRM UI)</div>
          <div class="value">${cManual.toLocaleString()}</div>
          <div class="delta-row muted small">${cPct(cManual)} of deals</div>
        </div>
        <div class="kpi">
          <div class="label">Other source</div>
          <div class="value">${cOther.toLocaleString()}</div>
          <div class="delta-row muted small">${cPct(cOther)} of deals</div>
        </div>
      </div>` : `
      <div class="kpi" style="margin-top: 4px; border-left:4px solid ${THEME.tokens.yellowDeep};">
        <div class="label">Awaiting sync</div>
        <div class="value" style="font-size: 15px; font-weight: 600;">Record source not backfilled yet</div>
        <div class="delta-row muted small">Runs on the next sync (now pulls hs_object_source). Trigger one to populate.</div>
      </div>`}
    </section>

    <section>
      <h3>Division leaderboard</h3>
      <p class="section-caption"><strong>Worked</strong> = HubSpot deal has ≥1 logged call.</p>
      <div class="table-wrap">
        <table class="dt">
          <thead><tr>
            <th>Division</th>
            <th class="num">Leads</th>
            <th class="num">Worked</th>
            <th class="num">Deals</th>
            <th>Worked %</th>
            <th>Deal %</th>
          </tr></thead>
          <tbody>${boardRows.map(r => `
            <tr>
              <td>${escapeHtml(r.div)}</td>
              <td class="num">${r.leads.toLocaleString()}</td>
              <td class="num">${r.worked.toLocaleString()}</td>
              <td class="num">${r.deals.toLocaleString()}</td>
              <td>${barCell(r.workedPct)}</td>
              <td>${barCell(r.dealPct)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h3>Where each division's leads sit</h3>
      <p class="section-caption">Top 15 divisions × HubSpot stages. <strong>Hot Lead</strong> is bright red; <strong>No deal yet</strong> is muted slate.</p>
      <div id="breakdown-chart" style="height: ${Math.max(420, 32 * topDivs.length + 80)}px;"></div>
    </section>

    <section class="card">
      <h3>Drill into a division</h3>
      <label class="muted" style="font-size: 12px;">Division
        <select id="div-drill" style="margin-left: 8px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--line); font-family: var(--sans);">
          ${boardRows.map(r => `<option value="${escapeHtml(r.div)}">${escapeHtml(r.div)}</option>`).join("")}
        </select>
      </label>
      <div id="drill-content" style="margin-top: 16px;"></div>
    </section>
  `;

  // Wire the lead economics panel (source pick, per-source cost inputs,
  // qualified-stage checkboxes). Toggles recalc figures live, no re-render.
  econWire();

  // Export PDF — hands the current pipeline view to the browser's print dialog
  // (Save as PDF) for the management team. The print stylesheet hides the app
  // chrome (top nav, sidebar, interactive buttons) so only the report prints.
  const pdfBtn = document.getElementById("pipeline-export-pdf");
  if (pdfBtn) pdfBtn.addEventListener("click", () => window.print());

  // Meta panel — collapsed by default. Plotly must size against a visible
  // container, so render the Meta block lazily the first time it's opened.
  const $metaPanel = document.getElementById("meta-panel");
  const $metaBlock = document.getElementById("meta-block");
  let metaRendered = false;
  if ($metaPanel && $metaBlock && typeof window.renderMetaBlock === "function") {
    $metaPanel.addEventListener("toggle", () => {
      if (!$metaPanel.open || metaRendered) return;
      metaRendered = true;
      try {
        window.renderMetaBlock($metaBlock, ctx);
      } catch (e) {
        console.error(e);
        $metaBlock.innerHTML = `<div class="error-box">Meta block error: ${escapeHtml(e.message || String(e))}</div>`;
      }
    });
  }

  // Funnel — rendered as a horizontal bar chart (the "funnel" trace type is
  // not in the plotly-basic bundle this app loads). Bars shrink top→bottom
  // and carry value + %-of-initial labels, so it reads like a funnel.
  const funLabels = ["Leads received", "Qualified lead-type", "Deal created", "Worked (call logged)"];
  const funVals = [nLeads, nQualified, nDeal, nWorked];
  const funText = funVals.map(v => `${v.toLocaleString()}  (${nLeads ? (v / nLeads * 100).toFixed(0) : 0}%)`);
  Plotly.newPlot("funnel-chart", [{
    type: "bar", orientation: "h",
    y: funLabels.slice().reverse(),
    x: funVals.slice().reverse(),
    text: funText.slice().reverse(),
    textposition: "auto",
    insidetextanchor: "middle",
    marker: { color: THEME.PALETTE.slice(0, 4).reverse() },
    hovertemplate: "%{y}: %{x:,}<extra></extra>",
  }], { ...THEME.PLOTLY_LAYOUT, margin: { l: 160, r: 24, t: 24, b: 24 },
        xaxis: { ...THEME.PLOTLY_LAYOUT.xaxis, title: "Leads" } }, THEME.PLOTLY_CONFIG);

  // Stage bar — chronological top→bottom, labelled with count + HubSpot win %.
  Plotly.newPlot("stage-chart", [{
    type: "bar", orientation: "h",
    y: stageRows.map(r => r[0]).reverse(),
    x: stageRows.map(r => r[1]).reverse(),
    text: stageRows.map(r => { const p = stagePct(r[0]); return p == null ? `${r[1]}` : `${r[1]}  ·  ${p}%`; }).reverse(),
    textposition: "auto",
    marker: { color: stageRows.map(r => stageCmap[r[0]]).reverse() },
    hovertemplate: "%{y}<br>%{x} deals<extra></extra>",
  }], { ...THEME.PLOTLY_LAYOUT, margin: { l: 220, r: 24, t: 24, b: 40 },
        xaxis: { ...THEME.PLOTLY_LAYOUT.xaxis, title: "Deals" } }, THEME.PLOTLY_CONFIG);

  // Click a stage bar → list that stage's deals, each linking to the actual
  // HubSpot deal (portal deep-link) with its address / owner / calls. The bar
  // is an aggregate, so this drills from stage → the underlying deals.
  const $stageEl = document.getElementById("stage-chart");
  const $stageDeals = document.getElementById("stage-deals");
  let openStage = null;
  function renderStageDeals(stage) {
    // Toggle: clicking the open stage again closes the panel.
    if (openStage === stage) { openStage = null; $stageDeals.innerHTML = ""; return; }
    openStage = stage;
    const deals = withDeal
      .filter(l => l.current_stage === stage)
      .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)
                   || (b.datestamp || "").localeCompare(a.datestamp || ""));
    const rows = deals.map(l => {
      const addr = l.property_address
        ? escapeHtml(l.property_address) + (l.suburb ? `, ${escapeHtml(l.suburb)}` : "")
        : (l.client_name ? escapeHtml(l.client_name) : (l.deal_name ? escapeHtml(l.deal_name) : "(no address)"));
      const amt = l.amount ? "R" + Number(l.amount).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";
      const calls = l.num_calls > 0 ? `${l.num_calls} call${l.num_calls === 1 ? "" : "s"}` : "—";
      const link = l.deal_id
        ? `<a href="${UTILS.hsDealLink(l.deal_id)}" target="_blank" rel="noopener">Open ↗</a>`
        : `<span class="muted">no deal id</span>`;
      return `<tr>
        <td>${addr}${l.deal_name && l.property_address ? `<div class="muted small">${escapeHtml(l.deal_name)}</div>` : ""}</td>
        <td>${l.source ? `<span class="pill">${escapeHtml(l.source)}</span>` : `<span class="muted">—</span>`}</td>
        <td>${escapeHtml(l.division || "—")}</td>
        <td class="num">${escapeHtml(calls)}</td>
        <td class="num">${amt}</td>
        <td class="num">${link}</td>
      </tr>`;
    }).join("");
    $stageDeals.innerHTML = `
      <div class="card" style="margin-top:12px; padding:14px 16px; border-left:4px solid ${stageCmap[stage] || "#888"};">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div style="font-weight:700; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span style="display:inline-block;width:11px;height:11px;border-radius:2px;background:${stageCmap[stage] || "#888"};"></span>
            <span>${escapeHtml(stage)}</span>
            <span class="muted small">${deals.length.toLocaleString()} deal${deals.length === 1 ? "" : "s"} · click the bar again to close</span>
          </div>
        </div>
        <div class="table-wrap" style="margin-top:10px;">
          <table class="dt">
            <thead><tr>
              <th>Address</th><th>Source</th><th>Division</th>
              <th class="num">Calls</th><th class="num">Amount</th><th class="num">HubSpot</th>
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="6" class="muted" style="padding:14px;">No deals in this stage in the current filters.</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
    $stageDeals.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  if ($stageEl && $stageEl.on) {
    $stageEl.on("plotly_click", ev => {
      const p = ev && ev.points && ev.points[0];
      if (p && p.y) renderStageDeals(p.y);
    });
  }

  // Breakdown stacked
  Plotly.newPlot("breakdown-chart", breakdownTraces,
    { ...THEME.PLOTLY_LAYOUT, barmode: "stack", margin: { l: 140, r: 24, t: 24, b: 40 },
      legend: { ...THEME.PLOTLY_LAYOUT.legend, title: { text: "HubSpot stage" } } },
    THEME.PLOTLY_CONFIG);

  // Drill
  const $sel = document.getElementById("div-drill");
  const $drill = document.getElementById("drill-content");
  function renderDrill() {
    const div = $sel.value;
    const sub = leads.filter(l => l.division === div);
    const byStage2 = {};
    let valueByStage = {};
    let workedByStage = {};
    for (const l of sub) {
      const stage = (l.current_stage || "").trim() || "No deal yet";
      byStage2[stage] = (byStage2[stage] || 0) + 1;
      if (l.amount) valueByStage[stage] = (valueByStage[stage] || 0) + Number(l.amount);
      if (l.worked) workedByStage[stage] = (workedByStage[stage] || 0) + 1;
    }
    const order = stageOrder.filter(s => byStage2[s] > 0).concat(
      Object.keys(byStage2).filter(s => !stageOrder.includes(s))
    );
    const total = sub.length;
    const dealsOnly = sub.filter(l => l.has_deal).length;
    $drill.innerHTML = `
      <p><strong>${escapeHtml(div)}</strong> — ${total} leads in this view · ${dealsOnly} have a HubSpot deal · ${total - dealsOnly} have no deal yet</p>
      <div class="table-wrap">
        <table class="dt">
          <thead><tr>
            <th>HubSpot stage</th>
            <th class="num">Leads</th>
            <th class="num">Worked</th>
            <th>Worked %</th>
            <th class="num">Open value (R)</th>
          </tr></thead>
          <tbody>${order.map(s => {
            const n = byStage2[s] || 0;
            const w = workedByStage[s] || 0;
            const v = valueByStage[s] || 0;
            const pct = n ? (w / n * 100) : 0;
            return `<tr>
              <td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${cmapDiv[s] || "#888"};margin-right:8px;vertical-align:middle;"></span>${escapeHtml(s)}</td>
              <td class="num">${n.toLocaleString()}</td>
              <td class="num">${w.toLocaleString()}</td>
              <td>${barCell(pct)}</td>
              <td class="num">${v ? "R" + v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>
    `;
  }
  $sel.addEventListener("change", renderDrill);
  renderDrill();
};

function barCell(p) {
  const cls = p >= 75 ? "green" : p >= 50 ? "amber" : (p > 0 ? "red" : "");
  const w = Math.max(0, Math.min(100, p));
  return `<div class="bar ${cls}"><span style="width:${w}%"></span></div>
          <span class="muted small">${p.toFixed(1)}%</span>`;
}
