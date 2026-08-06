// Pipeline view — funnel + live stage bar + division leaderboard + per-division breakdown.
window.VIEWS = window.VIEWS || {};
window.VIEWS.pipeline = function (root, ctx) {
  const leads = ctx.view.leads;
  const { escapeHtml, emptyState } = UTILS;
  if (!leads.length) {
    root.innerHTML = `<h2>Pipeline</h2>${emptyState()}`;
    return;
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

  // Sales outcomes (item: "sold by us" vs "sold by competitor").
  const soldUs   = leads.filter(l => l.current_stage === STAGES.WON);
  const soldComp = leads.filter(l => l.current_stage === STAGES.LOST);
  const sumAmt   = arr => arr.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const soldUsVal = sumAmt(soldUs), soldCompVal = sumAmt(soldComp);
  const totalSold = soldUs.length + soldComp.length;
  const winRate   = totalSold ? (soldUs.length / totalSold * 100) : 0;
  const randMoney = v => v ? "R" + v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "R0";

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
    <h2>Pipeline</h2>
    <p class="lede">How leads convert from inbound → qualified → deal → worked (call logged).</p>

    <section class="card">
      <h3>Conversion funnel</h3>
      <div id="funnel-chart" style="height: 380px;"></div>
    </section>

    <section class="card">
      <h3>Where the deals are on HubSpot</h3>
      <p class="section-caption">Live deal stage from HubSpot, in pipeline order. Each bar shows the deal count and the stage's average <strong>win probability %</strong>. Refreshed every 30 min by the sync job.</p>
      <div id="stage-chart" style="height: 420px;"></div>
    </section>

    <section class="card">
      <h3>Sales outcomes</h3>
      <p class="section-caption"><strong>Sold by us</strong> = deals in the <em>Sold</em> stage · <strong>Sold by competitor</strong> = <em>Listed with Competitor</em>. Win rate = our sales ÷ all resolved sales.</p>
      <div class="kpis" style="margin-top: 4px;">
        <div class="kpi" style="border-left:4px solid ${THEME.tokens.green};">
          <div class="label">Sold by us</div>
          <div class="value">${soldUs.length.toLocaleString()}</div>
          <div class="delta-row muted small">${randMoney(soldUsVal)}</div>
        </div>
        <div class="kpi" style="border-left:4px solid #B91C1C;">
          <div class="label">Sold by competitor</div>
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
