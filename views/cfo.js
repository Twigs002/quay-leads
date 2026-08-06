// CFO view — the money lens on the lead book. Marketing spend (Meta at the
// per-lead rate), what it returns (qualified, sold, won revenue, ROI), and the
// live pipeline value both gross and probability-weighted. Super/admin only.
window.VIEWS = window.VIEWS || {};
window.VIEWS.cfo = function (root, ctx) {
  const leads = ctx.view.leads;
  const { pct, emptyState } = UTILS;

  if (!leads.length) {
    root.innerHTML = `<h2>CFO</h2><p class="lede">Showing 0 leads.</p>${emptyState()}`;
    return;
  }

  const rand = v => "R" + Math.round(v || 0).toLocaleString();
  // Compact rand for big money (R1.2m / R340k) so KPI values stay legible.
  const randC = v => {
    v = Number(v) || 0;
    if (Math.abs(v) >= 1e6) return "R" + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "m";
    if (Math.abs(v) >= 1e3) return "R" + Math.round(v / 1e3) + "k";
    return "R" + Math.round(v).toLocaleString();
  };
  const sumAmt = arr => arr.reduce((a, l) => a + (Number(l.amount) || 0), 0);

  // ── Meta marketing economics ────────────────────────────────────────────
  // The only spend we model: Meta/Facebook leads costed at the per-lead rate.
  // Everything downstream (qualified, sold, won value, ROI) is measured on the
  // SAME meta population so the return figure is honest, never inflated by
  // organic or referral revenue.
  const metaLeads     = leads.filter(l => STAGES.isMetaSource(l.source));
  const metaSpend     = metaLeads.length * STAGES.META_COST_PER_LEAD;
  const metaQualified = metaLeads.filter(l => STAGES.isQualified(l.current_stage));
  const metaWon       = metaLeads.filter(l => l.current_stage === STAGES.WON);
  const metaWonValue  = sumAmt(metaWon);
  const costPerQual   = metaQualified.length ? metaSpend / metaQualified.length : null;
  const costPerSale   = metaWon.length ? metaSpend / metaWon.length : null;
  const roi           = metaSpend ? metaWonValue / metaSpend : null;
  const metaSourceNames = [...new Set(metaLeads.map(l => (l.source || "").trim()).filter(Boolean))];

  // ── Meta spend vs projected commission (Costings suburb-value model) ──────
  // Match each Meta lead to its suburb + title-type average sale (House -> FT,
  // Apt/Flat -> ST) and value it at our commission rate. Potential assumes every
  // matched lead converts (upper bound); the deals figure is the same for meta
  // leads that already carry a HubSpot deal. Ties the Costings page to spend.
  const RATE = STAGES.COMMISSION_RATE;
  const ratePct = (RATE * 100).toFixed(1) + "%";
  const SS = window.SUBURB_SALES;
  let matchedMeta = 0, matchedMetaDeals = 0, potMetaComm = 0, potMetaDealComm = 0;
  if (SS && SS.find) {
    for (const l of metaLeads) {
      const srow = SS.find(l.suburb, l.property_type);
      if (!srow) continue;
      matchedMeta++;
      const c = (Number(srow.avg_price) || 0) * RATE;
      potMetaComm += c;
      if (l.has_deal) { matchedMetaDeals++; potMetaDealComm += c; }
    }
  }
  const projReturn = metaSpend ? potMetaComm / metaSpend : null;

  // ── Total pipeline &amp; revenue (all sources) ──────────────────────────────
  // Open = has a deal in a live stage (not sold, lost, or otherwise closed).
  // Weighted forecast multiplies each open deal by its HubSpot win probability.
  const TERMINAL = new Set([
    STAGES.WON, STAGES.LOST, "Let By Us", "Referred to Rentals",
    STAGES.OUT_OF_AREA, "Please delete (Provide note)", "Past Let - Leakage",
  ]);
  const withDeal = leads.filter(l => l.has_deal && l.current_stage);
  const openDeals = withDeal.filter(l => !TERMINAL.has(l.current_stage));
  const won  = leads.filter(l => l.current_stage === STAGES.WON);
  const lost = leads.filter(l => l.current_stage === STAGES.LOST);
  const wonValue  = sumAmt(won);
  const lostValue = sumAmt(lost);
  const pipelineValue = sumAmt(openDeals);
  const weightedForecast = openDeals.reduce(
    (a, l) => a + (Number(l.amount) || 0) * (l.probability != null && !isNaN(l.probability) ? l.probability : 0), 0);
  const resolved = won.length + lost.length;
  const winRate  = resolved ? (won.length / resolved * 100) : 0;

  // ── Whole-book pipeline value (pipeline_stage_value) ─────────────────────
  // The lead-scoped figures above sum to ~R0 because seller-lead deals rarely
  // carry an amount. This aggregate is the WHOLE default sales pipeline by
  // stage (every deal with a value), so the section shows real money. It is
  // NOT scoped by the dashboard filters. Falls back to the lead-scoped numbers
  // until the aggregate table is populated by the sync.
  const stageValue = (ctx.cache && ctx.cache.stageValue) || [];
  const haveSV = stageValue.length > 0;
  const openSV = stageValue.filter(r => r.is_open);
  const svByStage = label => stageValue.find(r => r.stage === label) || null;
  const svNum = (r, k) => (r ? Number(r[k]) || 0 : 0);
  const svGross = openSV.reduce((a, r) => a + svNum(r, "gross"), 0);
  const svWeighted = openSV.reduce((a, r) => a + svNum(r, "weighted"), 0);
  const svOpenCount = openSV.reduce((a, r) => a + (r.deal_count || 0), 0);
  const svWon = svByStage(STAGES.WON), svLost = svByStage(STAGES.LOST);

  const pipeVal   = haveSV ? svGross : pipelineValue;
  const pipeWtd   = haveSV ? svWeighted : weightedForecast;
  const pipeOpenN = haveSV ? svOpenCount : openDeals.length;
  const pipeWon   = haveSV && svWon ? svNum(svWon, "gross") : wonValue;
  const pipeLost  = haveSV && svLost ? svNum(svLost, "gross") : lostValue;
  const pipeWonN  = haveSV && svWon ? (svWon.deal_count || 0) : won.length;
  const pipeLostN = haveSV && svLost ? (svLost.deal_count || 0) : lost.length;
  const pipeResolved = pipeWonN + pipeLostN;
  const pipeWinRate  = pipeResolved ? (pipeWonN / pipeResolved * 100) : 0;
  const svUpdated = haveSV ? (stageValue[0].updated_at || "") : "";

  function money(label, value, sub, accent) {
    return `<div class="kpi"${accent ? ` style="border-left:4px solid ${accent};"` : ""}>
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${sub ? `<div class="delta-row muted small">${sub}</div>` : ""}
    </div>`;
  }

  const green = THEME.tokens.green, red = "#B91C1C", yellow = THEME.tokens.yellowDeep;

  root.innerHTML = `
    <h2>CFO</h2>
    <p class="lede">The money view of the lead book, over the ${leads.length.toLocaleString()} leads in the current filters.</p>

    <div class="kpis">
      ${money("Marketing spend (Meta)", randC(metaSpend), `${metaLeads.length.toLocaleString()} leads &times; ${rand(STAGES.META_COST_PER_LEAD)}`, yellow)}
      ${money("Won revenue (Meta)", randC(metaWonValue), `${metaWon.length.toLocaleString()} deals sold`, green)}
      ${money("Return on spend", roi == null ? "--" : (roi.toFixed(1) + "&times;"), roi == null ? "no meta sales yet" : "won revenue / spend", roi != null && roi >= 1 ? green : red)}
      ${money("Cost per sale (Meta)", costPerSale == null ? "--" : randC(costPerSale), costPerSale == null ? "no meta sales yet" : "spend / meta deals sold")}
      ${money("Cost per qualified (Meta)", costPerQual == null ? "--" : randC(costPerQual), costPerQual == null ? "none qualified yet" : `target ${rand(STAGES.QUALIFIED_TARGET_COST)}`, costPerQual != null && costPerQual > STAGES.QUALIFIED_TARGET_COST ? red : green)}
    </div>

    <section class="card" style="margin-top:16px;">
      <h3>Meta funnel economics</h3>
      <p class="section-caption">
        Meta leads costed at <strong>${rand(STAGES.META_COST_PER_LEAD)}</strong> each. Qualified = deal reached
        warm, hot, any mandate, or sold. Every figure is measured on the meta population only.
      </p>
      <div class="kpis" style="margin-top:4px;">
        ${money("Meta leads", metaLeads.length.toLocaleString(), `${rand(metaSpend)} spend`)}
        ${money("Qualified", metaQualified.length.toLocaleString(), pct(metaQualified.length, metaLeads.length))}
        ${money("Sold", metaWon.length.toLocaleString(), pct(metaWon.length, metaLeads.length))}
        ${money("Won value", randC(metaWonValue), "revenue from meta deals", green)}
      </div>
      <p class="muted small" style="margin-top:10px;">
        Counted as meta from source: ${metaSourceNames.length ? metaSourceNames.map(s => `<code>${UTILS.escapeHtml(s)}</code>`).join(" ") : "<em>none matched. Tell me the exact Meta source label.</em>"}
      </p>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Spend vs projected commission</h3>
      <p class="section-caption">
        The two sides side by side: what we <strong>pay</strong> for Meta leads (${rand(STAGES.META_COST_PER_LEAD)} each) against
        what they could <strong>earn</strong>. Each Meta lead is matched to its suburb + title-type average sale
        (<strong>House &rarr; FT</strong>, <strong>Apartment / Flat &rarr; ST</strong>) and valued at our
        <strong>${ratePct}</strong> commission. Potential assumes every matched lead converts, so it is an
        upper bound &mdash; see the <a href="#/costings">Costings</a> tab for the full model.
      </p>
      ${matchedMeta ? `
      <div class="model-flow card" style="display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:16px 18px; margin:4px 0 12px; background:var(--paper, #f6f8fc);">
        <span style="font-weight:800; font-size:20px; color:${yellow};">${randC(metaSpend)}</span>
        <span class="muted">spend on ${metaLeads.length.toLocaleString()} Meta leads</span>
        <span style="font-size:20px; color:var(--slate,#64748b);">&rarr;</span>
        <span class="muted">${matchedMeta.toLocaleString()} matched to a suburb value</span>
        <span style="font-size:20px; color:var(--slate,#64748b);">&rarr;</span>
        <span style="font-weight:800; font-size:20px; color:${green};">${randC(potMetaComm)}</span>
        <span class="muted">potential commission</span>
      </div>` : ""}
      <div class="kpis" style="margin-top:4px;">
        ${money("Meta spend", randC(metaSpend), `${metaLeads.length.toLocaleString()} leads &times; ${rand(STAGES.META_COST_PER_LEAD)}`, yellow)}
        ${money("Matched to a suburb value", matchedMeta.toLocaleString(), `${matchedMetaDeals.toLocaleString()} already have a deal`, THEME.tokens.blue)}
        ${money("Potential commission", randC(potMetaComm), "if every matched meta lead sold", green)}
        ${money("Projected return", projReturn == null || !matchedMeta ? "--" : (projReturn.toFixed(0) + "&times;"), "potential commission / spend", green)}
        ${money("From matched deals", randC(potMetaDealComm), "if every matched meta deal sold", green)}
      </div>
      ${!matchedMeta ? `<p class="muted small" style="margin-top:10px;">No Meta leads in view match a mapped suburb + type yet. Map more suburbs on the <a href="#/costings">Costings</a> tab.</p>` : ""}
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Live pipeline value (whole book)</h3>
      <p class="section-caption">
        <strong>Open pipeline</strong> is the gross value of every deal still in play across the
        sales pipeline. <strong>Weighted forecast</strong> multiplies each open deal by its HubSpot
        win probability.${haveSV ? ` This section is the whole deal book and is <strong>not</strong> narrowed by the filters above${svUpdated ? `, refreshed ${UTILS.escapeHtml(String(svUpdated).slice(0, 10))}` : ""}.` : " <em>Awaiting the first whole-book aggregate from the sync; showing seller-lead deals only for now.</em>"}
      </p>
      <div class="kpis" style="margin-top:4px;">
        ${money("Open pipeline", randC(pipeVal), `${pipeOpenN.toLocaleString()} live deals`, THEME.tokens.blue)}
        ${money("Weighted forecast", randC(pipeWtd), "probability-adjusted", green)}
        ${money("Won revenue", randC(pipeWon), `${pipeWonN.toLocaleString()} sold`, green)}
        ${money("Lost to competitor", randC(pipeLost), `${pipeLostN.toLocaleString()} listed elsewhere`, red)}
        ${money("Win rate", pipeWinRate.toFixed(0) + "%", `${pipeResolved.toLocaleString()} resolved`)}
      </div>
    </section>

    <div class="grid-2" style="margin-top:16px;">
      <section class="card">
        <h3>Pipeline value by stage</h3>
        <p class="section-caption">Gross value against the probability-weighted value, per open stage${haveSV ? " (whole book)" : ""}.</p>
        <div id="cfo-stage-chart" style="height:400px;"></div>
      </section>
      <section class="card">
        <h3>Won revenue by month</h3>
        <p class="section-caption">Value of deals in the <em>Sold</em> stage, by close month.</p>
        <div id="cfo-revenue-chart" style="height:400px;"></div>
      </section>
    </div>
  `;

  // ── Pipeline value by stage: gross vs weighted, chronological order ───────
  // Prefer the whole-book aggregate (open stages); fall back to the lead-scoped
  // open deals until the aggregate is populated.
  let stages, grossArr, weightedArr;
  if (haveSV) {
    const rows = openSV.slice().sort((a, b) => STAGES.orderIndex(a.stage) - STAGES.orderIndex(b.stage));
    stages = rows.map(r => r.stage);
    grossArr = rows.map(r => svNum(r, "gross"));
    weightedArr = rows.map(r => svNum(r, "weighted"));
  } else {
    const g = {}, w = {};
    for (const l of openDeals) {
      const s = l.current_stage;
      const amt = Number(l.amount) || 0;
      const p = (l.probability != null && !isNaN(l.probability)) ? l.probability : 0;
      g[s] = (g[s] || 0) + amt;
      w[s] = (w[s] || 0) + amt * p;
    }
    stages = Object.keys(g).sort((a, b) => STAGES.orderIndex(a) - STAGES.orderIndex(b));
    grossArr = stages.map(s => g[s]);
    weightedArr = stages.map(s => w[s]);
  }
  if (stages.length && grossArr.some(v => v > 0)) {
    Plotly.newPlot("cfo-stage-chart", [
      {
        type: "bar", orientation: "h", name: "Gross",
        y: stages.slice().reverse(),
        x: grossArr.slice().reverse(),
        marker: { color: THEME.tokens.blue },
        hovertemplate: "%{y}<br>gross %{x:,.0f}<extra></extra>",
      },
      {
        type: "bar", orientation: "h", name: "Weighted",
        y: stages.slice().reverse(),
        x: weightedArr.slice().reverse(),
        marker: { color: THEME.tokens.green },
        hovertemplate: "%{y}<br>weighted %{x:,.0f}<extra></extra>",
      },
    ], {
      ...THEME.PLOTLY_LAYOUT, barmode: "overlay", showlegend: true,
      margin: { l: 200, r: 24, t: 24, b: 40 },
      xaxis: { ...THEME.PLOTLY_LAYOUT.xaxis, title: "Rand" },
    }, THEME.PLOTLY_CONFIG);
  } else {
    document.getElementById("cfo-stage-chart").innerHTML =
      '<p class="muted" style="padding:24px 8px;">No open deals carry a value yet. Deal amounts are entered on a minority of deals in HubSpot; the whole-book total refreshes with the next sync.</p>';
  }

  // ── Won revenue by close month ───────────────────────────────────────────
  const byMonth = {};
  for (const l of won) {
    const raw = l.close_date || l.datestamp;
    const d = raw ? new Date(raw) : null;
    if (!d || isNaN(d)) continue;
    const key = d.toISOString().slice(0, 7);   // YYYY-MM
    byMonth[key] = (byMonth[key] || 0) + (Number(l.amount) || 0);
  }
  const months = Object.keys(byMonth).sort();
  if (months.length) {
    Plotly.newPlot("cfo-revenue-chart", [{
      type: "bar",
      x: months, y: months.map(m => byMonth[m]),
      marker: { color: THEME.tokens.green },
      hovertemplate: "%{x}<br>%{y:,.0f}<extra></extra>",
    }], {
      ...THEME.PLOTLY_LAYOUT, margin: { l: 64, r: 24, t: 24, b: 48 },
      yaxis: { ...THEME.PLOTLY_LAYOUT.yaxis, title: "Won revenue (R)" },
    }, THEME.PLOTLY_CONFIG);
  } else {
    document.getElementById("cfo-revenue-chart").innerHTML =
      '<p class="muted" style="padding:24px 8px;">No sold deals with a close date in the current filters.</p>';
  }
};
