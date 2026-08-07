// Actuals / Revenue view — the real money. Reads the commission register
// (ctx.cache.salesDeals, from the super/admin-gated sales_deals view) and shows
// what Quay 1 actually banked: commission by month and team, sales vs rentals,
// top suburbs, and cost-vs-return against Meta + Dialfire spend. Super/admin only.
window.VIEWS = window.VIEWS || {};
window.VIEWS.actuals = function (root, ctx) {
  if (!(ctx.user && (ctx.user.isSuper || ctx.user.isAdmin))) {
    root.innerHTML = `<h2>Actuals</h2>
      <div class="card" style="padding:20px;"><p class="muted">This page is restricted to super and admin users.</p></div>`;
    return;
  }

  const { escapeHtml } = UTILS;
  const grp = n => Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const randS = v => "R " + grp(v);
  const green = THEME.tokens.green, blue = THEME.tokens.blue, yellow = THEME.tokens.yellowDeep;

  const all = (ctx.cache && ctx.cache.salesDeals) || [];

  // No register data yet (view not migrated / sheet not shared / not super).
  if (!all.length) {
    root.innerHTML = `
      <h2>Actuals</h2>
      <p class="lede">Real commission banked, straight from the deal &amp; commission register.</p>
      <section class="card" style="margin-top:16px; padding:20px;">
        <h3>Waiting for the register</h3>
        <p class="muted">No sales-register rows loaded yet. This populates once the
        <code>sales_register</code> migration is applied and the register sheet is shared with the
        sync service account. It refreshes on the 30-minute sync.</p>
      </section>`;
    return;
  }

  const num = v => (v == null || v === "") ? 0 : (Number(v) || 0);
  const paid = all.filter(d => d.deal_status === "PAID_OUT");
  const salesPaid = paid.filter(d => !d.is_rental);
  const rentPaid = paid.filter(d => d.is_rental);
  const openDeals = all.filter(d => d.deal_status === "OPEN");

  const salesComm = salesPaid.reduce((a, d) => a + num(d.quay1_gross_comm), 0);
  const rentComm = rentPaid.reduce((a, d) => a + num(d.quay1_gross_comm), 0);
  const soldValue = salesPaid.reduce((a, d) => a + num(d.purchase_price), 0);
  const avgCommPerSale = salesPaid.length ? salesComm / salesPaid.length : 0;
  const openValue = openDeals.reduce((a, d) => a + num(d.purchase_price), 0);
  const openComm = openDeals.reduce((a, d) => a + num(d.quay1_gross_comm), 0);

  // ── Trailing-12-month cost vs return ──────────────────────────────────────
  // Actual commission banked in the last 12 months vs annualised acquisition +
  // calling cost. Cost side blends the Dialfire monthly run-rate (x12) with Meta
  // spend (meta leads in the last 12 months x R80). It mixes actual revenue with
  // cost assumptions, so it's a directional ROI, clearly flagged.
  const now = new Date();
  const cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const commT12 = salesPaid
    .filter(d => d.deal_date_d && d.deal_date_d >= cutoff)
    .reduce((a, d) => a + num(d.quay1_gross_comm), 0)
    + rentPaid.filter(d => d.deal_date_d && d.deal_date_d >= cutoff)
      .reduce((a, d) => a + num(d.quay1_gross_comm), 0);
  const leads = (ctx.cache && ctx.cache.leads) || [];
  const metaLeadsT12 = leads.filter(l => STAGES.isMetaSource(l.source) && l.datestamp_d && l.datestamp_d >= cutoff).length;
  const metaSpendT12 = metaLeadsT12 * STAGES.META_COST_PER_LEAD;
  const dialfireT12 = STAGES.DIALFIRE_MONTHLY_COST * 12;
  const costT12 = metaSpendT12 + dialfireT12;
  const roiMultiple = costT12 ? commT12 / costT12 : null;
  const netT12 = commT12 - costT12;

  function card(label, value, sub, accent) {
    return `<div class="kpi"${accent ? ` style="border-left:4px solid ${accent};"` : ""}>
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${sub ? `<div class="delta-row muted small">${sub}</div>` : ""}
    </div>`;
  }

  // ── By team ───────────────────────────────────────────────────────────────
  const teamMap = new Map();
  for (const d of salesPaid) {
    const t = d.division_name || "(none)";
    let g = teamMap.get(t);
    if (!g) { g = { team: t, n: 0, comm: 0, sold: 0 }; teamMap.set(t, g); }
    g.n++; g.comm += num(d.quay1_gross_comm); g.sold += num(d.purchase_price);
  }
  const teamRows = [...teamMap.values()].sort((a, b) => b.comm - a.comm);
  const teamBody = teamRows.map(g => `<tr>
      <td><strong>${escapeHtml(g.team)}</strong></td>
      <td class="num">${grp(g.n)}</td>
      <td class="num" style="color:${green}; font-weight:700;">${randS(g.comm)}</td>
      <td class="num">${randS(g.n ? g.comm / g.n : 0)}</td>
      <td class="num">${randS(g.sold)}</td>
    </tr>`).join("");

  // ── Top suburbs by commission banked ──────────────────────────────────────
  const subMap = new Map();
  for (const d of salesPaid) {
    const s = (d.suburb || "").trim();
    if (!s) continue;
    const key = s + "|" + (d.title_code || "?");
    let g = subMap.get(key);
    if (!g) { g = { suburb: s, type: d.title_code || "?", n: 0, comm: 0 }; subMap.set(key, g); }
    g.n++; g.comm += num(d.quay1_gross_comm);
  }
  const subRows = [...subMap.values()].sort((a, b) => b.comm - a.comm).slice(0, 12);
  const subBody = subRows.map(g => `<tr>
      <td><strong>${escapeHtml(g.suburb)}</strong></td>
      <td>${escapeHtml(g.type)}</td>
      <td class="num">${grp(g.n)}</td>
      <td class="num" style="color:${green}; font-weight:700;">${randS(g.comm)}</td>
      <td class="num">${randS(g.n ? g.comm / g.n : 0)}</td>
    </tr>`).join("");

  const roiTone = roiMultiple == null ? blue : (roiMultiple >= 1 ? green : "#B91C1C");

  root.innerHTML = `
    <h2>Actuals</h2>
    <p class="lede">Real commission banked, straight from the deal &amp; commission register (${grp(paid.length)} paid-out deals).</p>

    <section class="card" style="margin-top:16px;">
      <h3>Commission banked</h3>
      <p class="section-caption">Quay 1's share of commission on paid-out deals (excludes fallen-through and duplicates).</p>
      <div class="kpis" style="margin-top:4px;">
        ${card("Sales commission", randS(salesComm), `${grp(salesPaid.length)} sales paid out`, green)}
        ${card("Rentals commission", randS(rentComm), `${grp(rentPaid.length)} rentals paid out`, green)}
        ${card("Avg commission / sale", randS(avgCommPerSale), "Quay 1 share per sale", blue)}
        ${card("Property sold", randS(soldValue), "total purchase price transacted", blue)}
        ${card("Open pipeline", randS(openComm), `${grp(openDeals.length)} open · ${randS(openValue)} value`, yellow)}
      </div>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Cost vs return (last 12 months)</h3>
      <p class="section-caption">
        Actual commission banked in the last 12 months against annualised lead cost: Dialfire run-rate
        (${randS(STAGES.DIALFIRE_MONTHLY_COST)}/mo &times; 12) plus Meta spend (${grp(metaLeadsT12)} meta leads &times; ${randS(STAGES.META_COST_PER_LEAD)}).
        Blends real revenue with cost assumptions, so read it as directional.
      </p>
      <div class="kpis" style="margin-top:4px;">
        ${card("Commission banked (12m)", randS(commT12), "sales + rentals, paid out", green)}
        ${card("Lead cost (12m)", randS(costT12), `Dialfire ${randS(dialfireT12)} + Meta ${randS(metaSpendT12)}`, yellow)}
        ${card("Return on spend", roiMultiple == null ? "--" : roiMultiple.toFixed(1) + "×", `net ${randS(netT12)}`, roiTone)}
      </div>
    </section>

    <div class="grid-2" style="margin-top:16px;">
      <section class="card">
        <h3>Commission banked by month</h3>
        <p class="section-caption">Quay 1 commission on paid-out deals, by deal month.</p>
        <div id="actuals-month-chart" style="height:360px;"></div>
      </section>
      <section class="card">
        <h3>Sales vs rentals</h3>
        <p class="section-caption">Share of banked commission.</p>
        <div id="actuals-split-chart" style="height:360px;"></div>
      </section>
    </div>

    <section class="card" style="margin-top:16px;">
      <h3>By team</h3>
      <p class="section-caption">Paid-out sales commission per division (rentals excluded).</p>
      <div class="table-wrap"><table class="dt">
        <thead><tr><th>Team</th><th class="num">Sales</th><th class="num">Commission banked</th>
          <th class="num">Avg / sale</th><th class="num">Property sold</th></tr></thead>
        <tbody>${teamBody}</tbody>
      </table></div>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Top suburbs by commission</h3>
      <p class="section-caption">Where the banked commission comes from (paid-out sales).</p>
      <div class="table-wrap"><table class="dt">
        <thead><tr><th>Suburb</th><th>Type</th><th class="num">Sales</th>
          <th class="num">Commission banked</th><th class="num">Avg / sale</th></tr></thead>
        <tbody>${subBody}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px;">FT = Freehold Title (houses), ST = Sectional Title (apartments / flats / townhouses).</p>
    </section>
  `;

  // ── Commission banked by month (last 24 months) ───────────────────────────
  const byMonth = {};
  for (const d of salesPaid.concat(rentPaid)) {
    if (!d.deal_date_d) continue;
    const key = d.deal_date_d.getFullYear() + "-" + String(d.deal_date_d.getMonth() + 1).padStart(2, "0");
    byMonth[key] = (byMonth[key] || 0) + num(d.quay1_gross_comm);
  }
  const months = Object.keys(byMonth).sort().slice(-24);
  if (months.length) {
    Plotly.newPlot("actuals-month-chart", [{
      type: "bar",
      x: months,
      y: months.map(m => byMonth[m]),
      marker: { color: THEME.tokens.green },
      hovertemplate: "%{x}<br>R%{y:,.0f}<extra></extra>",
    }], {
      ...THEME.PLOTLY_LAYOUT, margin: { l: 64, r: 16, t: 16, b: 48 },
      yaxis: { ...THEME.PLOTLY_LAYOUT.yaxis, title: "Commission (R)" },
    }, THEME.PLOTLY_CONFIG);
  } else {
    document.getElementById("actuals-month-chart").innerHTML =
      '<p class="muted" style="padding:24px 8px;">No dated deals to chart yet.</p>';
  }

  // ── Sales vs rentals donut ────────────────────────────────────────────────
  if (salesComm > 0 || rentComm > 0) {
    Plotly.newPlot("actuals-split-chart", [{
      type: "pie", hole: 0.55,
      labels: ["Sales", "Rentals"],
      values: [salesComm, rentComm],
      marker: { colors: [THEME.tokens.blue, THEME.tokens.yellowDeep] },
      textinfo: "label+percent",
      hovertemplate: "%{label}<br>R%{value:,.0f}<extra></extra>",
    }], {
      ...THEME.PLOTLY_LAYOUT, margin: { l: 16, r: 16, t: 16, b: 16 }, showlegend: false,
    }, THEME.PLOTLY_CONFIG);
  } else {
    document.getElementById("actuals-split-chart").innerHTML =
      '<p class="muted" style="padding:24px 8px;">No commission to split yet.</p>';
  }
};
