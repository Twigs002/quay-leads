// Costings view — the plain-English money model behind a lead. What a lead
// costs (Meta = R80), what a sale earns us (avg 4.2% commission), and the
// projected payoff when an R80 lead converts. Plus a suburb average-sale-price
// reference (placeholder until mapped). Super/admin only.
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

  const COST = STAGES.META_COST_PER_LEAD;       // R80
  const RATE = STAGES.COMMISSION_RATE;          // 0.042
  const ratePct = (RATE * 100).toFixed(1) + "%";

  const sales = window.SUBURB_SALES || { ROWS: [], YEAR: 2025, PLACEHOLDER: true };
  const rows = sales.ROWS || [];

  // Reference average sale price = sales-weighted mean across the suburb rows
  // (falls back to a simple mean, then to 0 when there is no data yet).
  const totSales = rows.reduce((a, r) => a + (Number(r.num_sales) || 0), 0);
  const refAvgPrice = rows.length
    ? (totSales
        ? rows.reduce((a, r) => a + (Number(r.avg_price) || 0) * (Number(r.num_sales) || 0), 0) / totSales
        : rows.reduce((a, r) => a + (Number(r.avg_price) || 0), 0) / rows.length)
    : 0;

  const projCommission = refAvgPrice * RATE;                 // earned if one converts
  const netPerSale = projCommission - COST;                  // minus the one lead's cost
  const leadsFunded = projCommission ? Math.round(projCommission / COST) : 0;

  function card(label, value, sub, accent) {
    return `<div class="kpi"${accent ? ` style="border-left:4px solid ${accent};"` : ""}>
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${sub ? `<div class="delta-row muted small">${sub}</div>` : ""}
    </div>`;
  }

  const green = THEME.tokens.green, blue = THEME.tokens.blue, yellow = THEME.tokens.yellowDeep;

  // ── Suburb table rows (with a derived projected-commission column) ────────
  const cols = ["Suburb", "Type", `${sales.YEAR} Avg. Price`, "Total Spend", "No. of Sales",
    "Median Price", "Avg. R/m&sup2;", "Avg. Days on Market",
    `Proj. commission (${ratePct})`, "R80 leads / sale"];
  const bodyRows = rows.length
    ? rows.map(r => {
        const comm = (Number(r.avg_price) || 0) * RATE;
        const funds = comm ? Math.round(comm / COST) : 0;
        return `<tr>
          <td><strong>${escapeHtml(r.suburb)}</strong></td>
          <td>${escapeHtml(r.type || "")}</td>
          <td class="num">${randS(r.avg_price)}</td>
          <td class="num">${randS(r.total_spend)}</td>
          <td class="num">${grp(r.num_sales)}</td>
          <td class="num">${randS(r.median_price)}</td>
          <td class="num">${randS(r.avg_rate_per_m2)}</td>
          <td class="num">${grp(r.avg_days_on_market)}</td>
          <td class="num" style="color:${green}; font-weight:700;">${randS(comm)}</td>
          <td class="num">${grp(funds)}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="${cols.length}" class="muted" style="padding:18px;">No suburb data mapped yet.</td></tr>`;

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
        ${rows.length ? "sales-weighted average sale price across the mapped suburbs" : "average sale price (no suburbs mapped yet, so this reads R0)"}.
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
        ${card("Reference avg sale price", randS(refAvgPrice), rows.length ? `across ${grp(totSales)} sales` : "awaiting suburb data")}
        ${card("Projected commission / sale", randS(projCommission), `${ratePct} of the avg sale`, green)}
        ${card("Net per converting lead", randS(netPerSale), `commission minus the ${randS(COST)} lead`, green)}
        ${card("One sale funds", grp(leadsFunded) + " leads", `R80 Meta leads paid for by a single sale`, blue)}
      </div>
      <p class="muted small" style="margin-top:10px;">
        This is the gross payoff <em>per converting lead</em> — it does not yet divide by the conversion
        rate (how many R80 leads it takes to land one sale). Once we track that, we can show cost per
        actual sale here too.
      </p>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Average sale price by suburb${sales.PLACEHOLDER ? ` &middot; <span class="pill" style="background:#FEF3C7;color:#92400E;">placeholder</span>` : ""}</h3>
      <p class="section-caption">
        ${sales.PLACEHOLDER
          ? "Sample data — the full suburb map drops in here once it is ready. The <strong>projected commission</strong> column is derived live from each suburb's average price."
          : "Mapped suburb averages. <strong>Projected commission</strong> is the average price times our commission rate."}
      </p>
      <div class="table-wrap"><table class="dt">
        <thead><tr>${cols.map((c, i) => `<th${i >= 2 ? ' class="num"' : ""}>${c}</th>`).join("")}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px;">Type: FT = Freehold Title, ST = Sectional Title.</p>
    </section>
  `;
};
