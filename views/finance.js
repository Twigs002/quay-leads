// Finance — executive summary for super/admin. One screen: the headline money
// numbers (real commission banked + return on spend, live pipeline, lead spend)
// and the two charts that matter (commission banked by month, pipeline value by
// stage). The detailed model — break-even, the suburb-value projection, cost
// per Dialfire lead, attribution, by-team / top-suburb / suburb-reference tables
// — was intentionally removed to keep this a glance-and-go page.
window.VIEWS = window.VIEWS || {};
window.VIEWS.finance = function (root, ctx) {
  // Gate: super/admin only (tab is hidden otherwise, but re-check in body).
  if (!(ctx.user && (ctx.user.isSuper || ctx.user.isAdmin))) {
    root.innerHTML = `<h2>Finance</h2>
      <div class="card" style="padding:20px;"><p class="muted">This page is restricted to super and admin users.</p></div>`;
    return;
  }

  const randC = v => {                         // compact rand (R1.2m / R340k)
    v = Number(v) || 0;
    if (Math.abs(v) >= 1e6) return "R" + (v / 1e6).toFixed(Math.abs(v) >= 1e7 ? 0 : 1) + "m";
    if (Math.abs(v) >= 1e3) return "R" + Math.round(v / 1e3) + "k";
    return "R" + Math.round(v).toLocaleString();
  };
  const num = v => (v == null || v === "") ? 0 : (Number(v) || 0);
  const green = THEME.tokens.green, blue = THEME.tokens.blue, yellow = THEME.tokens.yellowDeep, red = "#B91C1C";

  function card(label, value, sub, accent) {
    return `<div class="kpi"${accent ? ` style="border-left:4px solid ${accent};"` : ""}>
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${sub ? `<div class="delta-row muted small">${sub}</div>` : ""}
    </div>`;
  }

  const allLeads = (ctx.cache && ctx.cache.leads) || [];
  const _now = new Date();

  // ── Real commission banked + trailing-12-month return ─────────────────────
  const salesDeals = (ctx.cache && ctx.cache.salesDeals) || [];
  const haveReg = salesDeals.length > 0;
  const paid = salesDeals.filter(d => d.deal_status === "PAID_OUT");
  const cutoff = new Date(_now.getFullYear() - 1, _now.getMonth(), _now.getDate());
  const inT12 = d => d.deal_date_d && d.deal_date_d >= cutoff;
  const commT12 = paid.filter(inT12).reduce((a, d) => a + num(d.total_gross_comm), 0);

  const metaLeadsT12 = allLeads.filter(l => STAGES.isMetaSource(l.source) && l.datestamp_d && l.datestamp_d >= cutoff).length;
  const metaSpendT12 = metaLeadsT12 * STAGES.META_COST_PER_LEAD;
  const dialfireT12  = STAGES.DIALFIRE_MONTHLY_COST * 12;
  const costT12      = metaSpendT12 + dialfireT12;
  const roiMultiple  = costT12 ? commT12 / costT12 : null;
  const netT12       = commT12 - costT12;
  const roiTone = roiMultiple == null ? blue : (roiMultiple >= 1 ? green : red);

  // ── Live pipeline value (whole-book aggregate, filters ignored) ───────────
  const stageValue = (ctx.cache && ctx.cache.stageValue) || [];
  const haveSV = stageValue.length > 0;
  const openSV = stageValue.filter(r => r.is_open);
  const svNum = (r, k) => (r ? Number(r[k]) || 0 : 0);

  // Fallback to the filtered lead-scoped deals until the whole-book aggregate exists.
  const leads = (ctx.view && ctx.view.leads) || [];
  const TERMINAL = new Set([
    STAGES.WON, STAGES.LOST, "Let By Us", "Referred to Rentals",
    STAGES.OUT_OF_AREA, "Please delete (Provide note)", "Past Let - Leakage",
  ]);
  const openDeals = leads.filter(l => l.has_deal && l.current_stage && !TERMINAL.has(l.current_stage));

  const pipeVal   = haveSV ? openSV.reduce((a, r) => a + svNum(r, "gross"), 0)
                           : openDeals.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const pipeOpenN = haveSV ? openSV.reduce((a, r) => a + (r.deal_count || 0), 0) : openDeals.length;

  // ── Render ────────────────────────────────────────────────────────────────
  root.innerHTML = `
    <h2>Finance</h2>
    <p class="lede">The money at a glance — real commission banked, its return on the last 12 months of lead spend, and the live pipeline. Whole book; not narrowed by the filters.</p>

    <div class="kpis" style="margin-top:16px;">
      ${card("Commission banked (12m)", haveReg ? randC(commT12) : "--", haveReg ? "sales + rentals, paid out" : "register not loaded yet", green)}
      ${card("Return on spend (12m)", roiMultiple == null ? "--" : roiMultiple.toFixed(1) + "&times;", roiMultiple == null ? "" : `net ${randC(netT12)} · real revenue / lead cost`, roiTone)}
      ${card("Open pipeline value", randC(pipeVal), `${pipeOpenN.toLocaleString()} live deals${haveSV ? " · whole book" : ""}`, blue)}
      ${card("Lead spend (12m)", randC(costT12), `Dialfire ${randC(dialfireT12)} + Meta ${randC(metaSpendT12)}`, yellow)}
    </div>

    <section class="card" style="margin-top:16px;">
      <h3>Commission banked by month</h3>
      <p class="section-caption">Total agency commission on paid-out deals, by deal month (last 24 months).</p>
      <div id="fin-month-chart" style="height:360px;"></div>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Pipeline value by stage</h3>
      <p class="section-caption">Gross value against the probability-weighted value, per open stage${haveSV ? " (whole book)" : ""}.</p>
      <div id="fin-stage-chart" style="height:400px;"></div>
    </section>
  `;

  // ── Chart: commission banked by month (real register) ─────────────────────
  const monthEl = document.getElementById("fin-month-chart");
  if (haveReg) {
    const byMonth = {};
    for (const d of paid) {
      if (!d.deal_date_d) continue;
      const key = d.deal_date_d.getFullYear() + "-" + String(d.deal_date_d.getMonth() + 1).padStart(2, "0");
      byMonth[key] = (byMonth[key] || 0) + num(d.total_gross_comm);
    }
    const months = Object.keys(byMonth).sort().slice(-24);
    if (months.length) {
      Plotly.newPlot("fin-month-chart", [{
        type: "bar", x: months, y: months.map(m => byMonth[m]),
        marker: { color: THEME.tokens.green },
        hovertemplate: "%{x}<br>R%{y:,.0f}<extra></extra>",
      }], {
        ...THEME.PLOTLY_LAYOUT, margin: { l: 64, r: 16, t: 16, b: 48 },
        yaxis: { ...THEME.PLOTLY_LAYOUT.yaxis, title: "Commission (R)" },
      }, THEME.PLOTLY_CONFIG);
    } else if (monthEl) {
      monthEl.innerHTML = '<p class="muted" style="padding:24px 8px;">No dated deals to chart yet.</p>';
    }
  } else if (monthEl) {
    monthEl.innerHTML = '<p class="muted" style="padding:24px 8px;">No sales-register rows loaded yet. This populates once the register migration is applied and the sheet is shared with the sync service account.</p>';
  }

  // ── Chart: pipeline value by stage (gross vs weighted) ────────────────────
  let stages, grossArr, weightedArr;
  if (haveSV) {
    const svRows = openSV.slice().sort((a, b) => STAGES.orderIndex(a.stage) - STAGES.orderIndex(b.stage));
    stages = svRows.map(r => r.stage);
    grossArr = svRows.map(r => svNum(r, "gross"));
    weightedArr = svRows.map(r => svNum(r, "weighted"));
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
  const stageEl = document.getElementById("fin-stage-chart");
  if (stages.length && grossArr.some(v => v > 0)) {
    Plotly.newPlot("fin-stage-chart", [
      { type: "bar", orientation: "h", name: "Gross",
        y: stages.slice().reverse(), x: grossArr.slice().reverse(),
        marker: { color: THEME.tokens.blue },
        hovertemplate: "%{y}<br>gross %{x:,.0f}<extra></extra>" },
      { type: "bar", orientation: "h", name: "Weighted",
        y: stages.slice().reverse(), x: weightedArr.slice().reverse(),
        marker: { color: THEME.tokens.green },
        hovertemplate: "%{y}<br>weighted %{x:,.0f}<extra></extra>" },
    ], {
      ...THEME.PLOTLY_LAYOUT, barmode: "overlay", showlegend: true,
      margin: { l: 200, r: 24, t: 24, b: 40 },
      xaxis: { ...THEME.PLOTLY_LAYOUT.xaxis, title: "Rand" },
    }, THEME.PLOTLY_CONFIG);
  } else if (stageEl) {
    stageEl.innerHTML = '<p class="muted" style="padding:24px 8px;">No open deals carry a value yet. Deal amounts are entered on a minority of HubSpot deals; the whole-book total refreshes with the next sync.</p>';
  }
};
