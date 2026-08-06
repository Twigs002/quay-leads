// Costings view — the plain-English money model behind a lead. What a lead
// costs (Meta = R80), what a sale earns us (avg 4.2% commission), the projected
// payoff when an R80 lead converts, and the live deals matched to a suburb's
// average sale price by suburb + title type. Super/admin only.
window.VIEWS = window.VIEWS || {};
window.VIEWS.costings = function (root, ctx) {
  // Gate: super/admin only, matching the CFO view.
  if (!(ctx.user && (ctx.user.isSuper || ctx.user.isAdmin))) {
    root.innerHTML = `<h2>Costings</h2>
      <div class="card" style="padding:20px;"><p class="muted">This page is restricted to super and admin users.</p></div>`;
    return;
  }

  const { escapeHtml } = UTILS;
  // South-African style money: "R 6 341 674" (space thousands separators).
  const grp = n => Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const randS = v => "R " + grp(v);
  const naCell = v => (v == null || v === "") ? '<span class="muted">n/a</span>' : randS(v);

  const COST = STAGES.META_COST_PER_LEAD;       // R80
  const RATE = STAGES.COMMISSION_RATE;          // 0.042
  const ratePct = (RATE * 100).toFixed(1) + "%";

  const sales = window.SUBURB_SALES || { ROWS: [], YEAR: 2025, PLACEHOLDER: false, find: () => null };
  const rows = sales.ROWS || [];

  // Reference average sale price = sales-weighted mean across rows that carry a
  // sales count (rows with only avg_price don't distort it). Falls back to 0.
  const weighted = rows.filter(r => Number(r.num_sales) > 0);
  const totSales = weighted.reduce((a, r) => a + Number(r.num_sales), 0);
  const refAvgPrice = totSales
    ? weighted.reduce((a, r) => a + (Number(r.avg_price) || 0) * Number(r.num_sales), 0) / totSales
    : 0;

  const projCommission = refAvgPrice * RATE;
  const netPerSale = projCommission - COST;
  const leadsFunded = projCommission ? Math.round(projCommission / COST) : 0;

  // ── Match the leads in view to a suburb + title-type sale row ─────────────
  // House -> FT, Apartment/Flat/Townhouse -> ST (see suburb_sales.titleCode).
  const leads = (ctx.view && ctx.view.leads) || [];
  const groups = {};   // "Suburb|FT" -> { row, leads, deals }
  let matchedLeads = 0, matchedDeals = 0;
  for (const l of leads) {
    const row = sales.find ? sales.find(l.suburb, l.property_type) : null;
    if (!row) continue;
    matchedLeads++;
    if (l.has_deal) matchedDeals++;
    const key = row.suburb + "|" + row.type;
    (groups[key] || (groups[key] = { row, leads: 0, deals: 0 })).leads++;
    if (l.has_deal) groups[key].deals++;
  }
  const groupRows = Object.values(groups).sort((a, b) => b.leads - a.leads);
  const potentialPool = groupRows.reduce((a, g) => a + g.leads * (Number(g.row.avg_price) || 0) * RATE, 0);
  const dealPool = groupRows.reduce((a, g) => a + g.deals * (Number(g.row.avg_price) || 0) * RATE, 0);

  function card(label, value, sub, accent) {
    return `<div class="kpi"${accent ? ` style="border-left:4px solid ${accent};"` : ""}>
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${sub ? `<div class="delta-row muted small">${sub}</div>` : ""}
    </div>`;
  }

  const green = THEME.tokens.green, blue = THEME.tokens.blue, yellow = THEME.tokens.yellowDeep;

  // ── Suburb reference table ────────────────────────────────────────────────
  const cols = ["Team", "Suburb", "Type", `${sales.YEAR} Avg. Price`, "Total Spend", "No. of Sales",
    "Median Price", "Avg. R/m&sup2;", "Avg. Days on Market",
    `Proj. commission (${ratePct})`, "R80 leads / sale"];
  const numFrom = 3; // columns index >= 3 are right-aligned numbers
  const suburbBody = rows.length
    ? rows.map(r => {
        const comm = (Number(r.avg_price) || 0) * RATE;
        const funds = comm ? Math.round(comm / COST) : 0;
        const daysCell = r.avg_days_on_market == null ? '<span class="muted">n/a</span>' : grp(r.avg_days_on_market);
        return `<tr>
          <td>${escapeHtml(r.team || "")}</td>
          <td><strong>${escapeHtml(r.suburb)}</strong></td>
          <td>${escapeHtml(r.type || "")}</td>
          <td class="num">${naCell(r.avg_price)}</td>
          <td class="num">${naCell(r.total_spend)}</td>
          <td class="num">${r.num_sales == null ? '<span class="muted">n/a</span>' : grp(r.num_sales)}</td>
          <td class="num">${naCell(r.median_price)}</td>
          <td class="num">${naCell(r.avg_rate_per_m2)}</td>
          <td class="num">${daysCell}</td>
          <td class="num" style="color:${green}; font-weight:700;">${randS(comm)}</td>
          <td class="num">${grp(funds)}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="${cols.length}" class="muted" style="padding:18px;">No suburb data mapped yet.</td></tr>`;

  // ── Matched-deals table ───────────────────────────────────────────────────
  const matchBody = groupRows.length
    ? groupRows.map(g => {
        const commPer = (Number(g.row.avg_price) || 0) * RATE;
        return `<tr>
          <td>${escapeHtml(g.row.team || "")}</td>
          <td><strong>${escapeHtml(g.row.suburb)}</strong></td>
          <td>${escapeHtml(g.row.type)}${g.row.type === "FT" ? " · House" : " · Apt/Flat"}</td>
          <td class="num">${grp(g.leads)}</td>
          <td class="num">${grp(g.deals)}</td>
          <td class="num">${randS(g.row.avg_price)}</td>
          <td class="num" style="color:${green}; font-weight:700;">${randS(commPer)}</td>
          <td class="num">${randS(g.leads * commPer)}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="8" class="muted" style="padding:18px;">No leads in the current view match a mapped suburb + type yet.</td></tr>`;

  root.innerHTML = `
    <h2>Costings</h2>
    <p class="lede">What a lead costs us, what a sale earns us, and the payoff when the two meet.</p>

    <section class="card" style="margin-top:16px;">
      <h3>The plain numbers</h3>
      <p class="section-caption">The two inputs behind every projection on this page.</p>
      <div class="kpis" style="margin-top:4px;">
        ${card("Meta lead", randS(COST), "what we pay per Meta / Facebook lead", yellow)}
        ${card("Average commission", ratePct, "of the sale price, on a successful sale", blue)}
      </div>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Projected earnings from one Meta lead</h3>
      <p class="section-caption">
        Pay <strong>${randS(COST)}</strong> for a Meta lead. If it becomes a sale, we earn
        <strong>${ratePct}</strong> of the sale price in commission. Figures below use the
        sales-weighted average sale price across the mapped suburbs.
      </p>
      <div class="model-flow card" style="display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:16px 18px; margin:4px 0 12px; background:var(--paper, #f6f8fc);">
        <span style="font-weight:800; font-size:20px;">${randS(COST)}</span>
        <span class="muted">Meta lead</span>
        <span style="font-size:20px; color:var(--slate,#64748b);">&rarr;</span>
        <span class="muted">converts to a sale @ ${randS(refAvgPrice)}</span>
        <span style="font-size:20px; color:var(--slate,#64748b);">&rarr;</span>
        <span style="font-weight:800; font-size:20px; color:${green};">${randS(projCommission)}</span>
        <span class="muted">commission (${ratePct})</span>
      </div>
      <div class="kpis" style="margin-top:4px;">
        ${card("Reference avg sale price", randS(refAvgPrice), `across ${grp(totSales)} sales`)}
        ${card("Projected commission / sale", randS(projCommission), `${ratePct} of the avg sale`, green)}
        ${card("Net per converting lead", randS(netPerSale), `commission minus the ${randS(COST)} lead`, green)}
        ${card("One sale funds", grp(leadsFunded) + " leads", `R80 Meta leads paid for by a single sale`, blue)}
      </div>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Live deals matched to suburb values</h3>
      <p class="section-caption">
        Each lead in the current view is matched to a suburb + title type
        (<strong>House &rarr; FT</strong>, <strong>Apartment / Flat &rarr; ST</strong>) and priced at that
        suburb's average sale. <strong>Potential commission</strong> assumes every matched lead converts, so
        it is an upper bound, not a forecast.
      </p>
      <div class="kpis" style="margin-top:4px;">
        ${card("Matched leads", grp(matchedLeads), `of ${grp(leads.length)} in view`, blue)}
        ${card("Matched with a deal", grp(matchedDeals), "already have a HubSpot deal")}
        ${card("Potential commission pool", randS(potentialPool), "if every matched lead sold", green)}
        ${card("From matched deals", randS(dealPool), "if every matched deal sold", green)}
      </div>
      <div class="table-wrap" style="margin-top:12px;"><table class="dt">
        <thead><tr>
          <th>Team</th><th>Suburb</th><th>Type</th>
          <th class="num">Matched leads</th><th class="num">With deal</th>
          <th class="num">Avg sale price</th><th class="num">Commission / sale</th>
          <th class="num">Potential pool</th>
        </tr></thead>
        <tbody>${matchBody}</tbody>
      </table></div>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Average sale price by suburb${sales.PLACEHOLDER ? ` &middot; <span class="pill" style="background:#FEF3C7;color:#92400E;">placeholder</span>` : ""}</h3>
      <p class="section-caption">
        Mapped suburb averages by title type. <strong>Projected commission</strong> is the average price
        times our ${ratePct} commission rate. Rows added later may show only the average price.
      </p>
      <div class="table-wrap"><table class="dt">
        <thead><tr>${cols.map((c, i) => `<th${i >= numFrom ? ' class="num"' : ""}>${c}</th>`).join("")}</tr></thead>
        <tbody>${suburbBody}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px;">Type: FT = Freehold Title (houses), ST = Sectional Title (apartments / flats / townhouses).</p>
    </section>
  `;
};
