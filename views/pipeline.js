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

  // Live stage bar
  const withDeal = leads.filter(l => l.has_deal && l.current_stage);
  const byStage = {};
  for (const l of withDeal) byStage[l.current_stage] = (byStage[l.current_stage] || 0) + 1;
  const stageRows = Object.entries(byStage).sort((a, b) => b[1] - a[1]);
  const stageCmap = THEME.stageColors(stageRows.map(r => r[0]));

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
  const stageVolumeTotal = {};
  for (const [k, v] of Object.entries(cellCounts)) {
    const stage = k.split("|")[1];
    if (stage !== "No deal yet") stageVolumeTotal[stage] = (stageVolumeTotal[stage] || 0) + v;
  }
  const stageOrder = Object.keys(stageVolumeTotal).sort((a, b) => stageVolumeTotal[b] - stageVolumeTotal[a]).concat(["No deal yet"]);
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
      <p class="section-caption">Live deal stage from HubSpot (refreshed every 30 min by the sync job).</p>
      <div id="stage-chart" style="height: 420px;"></div>
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

  // Funnel
  Plotly.newPlot("funnel-chart", [{
    type: "funnel",
    y: ["Leads received", "Qualified lead-type", "Deal created", "Worked (call logged)"],
    x: [nLeads, nQualified, nDeal, nWorked],
    textinfo: "value+percent initial",
    marker: { color: THEME.PALETTE.slice(0, 4) },
  }], { ...THEME.PLOTLY_LAYOUT, margin: { l: 160, r: 24, t: 24, b: 24 } }, THEME.PLOTLY_CONFIG);

  // Stage bar
  Plotly.newPlot("stage-chart", [{
    type: "bar", orientation: "h",
    y: stageRows.map(r => r[0]).reverse(),
    x: stageRows.map(r => r[1]).reverse(),
    marker: { color: stageRows.map(r => stageCmap[r[0]]).reverse() },
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
