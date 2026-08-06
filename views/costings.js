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

  // ── Break-even & expected value (conversion computed from the data) ───────
  // Cost side: every Meta lead is R80. Earn side: a sale earns 4.2% of the
  // price. Break-even is the conversion rate at which those two meet. We measure
  // three real milestones from the Meta population and compare them to it.
  // "Sold" is barely tracked in HubSpot (a couple of deals in the whole book),
  // so MANDATE WON (Sole/Other Mandate, or the rare Sold) is used as the sale
  // proxy — that is the point our commission is effectively secured.
  const metaLeads = leads.filter(l => STAGES.isMetaSource(l.source));
  const metaN = metaLeads.length;
  const metaSpend = metaN * COST;
  const metaQual = metaLeads.filter(l => STAGES.isQualified(l.current_stage)).length;
  const metaMandate = metaLeads.filter(l => STAGES.isWonListing(l.current_stage)).length;
  const metaSold = metaLeads.filter(l => l.current_stage === STAGES.WON).length;

  // Average commission per sale: use the suburb value of the Meta leads that
  // matched (so it reflects where our Meta leads actually are), else the
  // reference average. Times the commission rate.
  let mSum = 0, mCnt = 0;
  for (const l of metaLeads) {
    const r = sales.find ? sales.find(l.suburb, l.property_type) : null;
    if (r) { mSum += Number(r.avg_price) || 0; mCnt++; }
  }
  const avgSalePrice = mCnt ? mSum / mCnt : refAvgPrice;
  const avgCommission = avgSalePrice * RATE;

  const breakEvenRate = avgCommission ? COST / avgCommission : null;   // fraction
  const leadsPerSale = avgCommission ? Math.round(avgCommission / COST) : null;
  const mandateRate = metaN ? metaMandate / metaN : 0;
  const qualRate = metaN ? metaQual / metaN : 0;
  const soldRate = metaN ? metaSold / metaN : 0;
  const evPerLead = mandateRate * avgCommission;         // sale proxy = mandate won
  const netEv = evPerLead - COST;
  const evMultiple = COST ? evPerLead / COST : 0;
  const salesNeeded = avgCommission ? metaSpend / avgCommission : null;   // to cover total spend
  const beMultiple = (breakEvenRate && breakEvenRate > 0) ? mandateRate / breakEvenRate : null;
  const above = beMultiple != null && beMultiple >= 1;

  // Adaptive percent: tiny break-even rates need more decimals to be legible.
  const pctFmt = r => {
    const p = (r || 0) * 100;
    if (p === 0) return "0%";
    if (p < 0.1) return p.toFixed(3) + "%";
    if (p < 1) return p.toFixed(2) + "%";
    return p.toFixed(1) + "%";
  };

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
      <h3>Break-even &amp; expected value</h3>
      <p class="section-caption">
        The decision number: at <strong>${randS(COST)}</strong> a Meta lead and <strong>${ratePct}</strong>
        commission on an average sale of <strong>${randS(avgSalePrice)}</strong>, we break even when just
        <strong>${breakEvenRate == null ? "--" : pctFmt(breakEvenRate)}</strong> of leads convert
        (about <strong>1 sale per ${leadsPerSale == null ? "--" : grp(leadsPerSale)} leads</strong>).
        Conversion below is measured from the ${grp(metaN)} Meta leads in view.
      </p>
      <div class="card" style="padding:14px 18px; margin:4px 0 12px; border-left:4px solid ${above ? green : yellow}; background:var(--paper, #f6f8fc);">
        ${metaN === 0
          ? `<strong>No Meta leads in the current view.</strong> Adjust the filters to see the break-even picture.`
          : above
            ? `<strong>Above break-even.</strong> Mandates won on Meta leads run at <strong>${pctFmt(mandateRate)}</strong>, which is
               <strong>${beMultiple.toFixed(1)}&times;</strong> the <strong>${pctFmt(breakEvenRate)}</strong> needed to cover the ${randS(metaSpend)}
               spent on Meta. Break-even is ${salesNeeded == null ? "--" : Math.ceil(salesNeeded)} sale(s); we have ${grp(metaMandate)} mandate(s) won.`
            : `<strong>Below break-even so far.</strong> Mandates won on Meta leads are <strong>${pctFmt(mandateRate)}</strong> versus the
               <strong>${pctFmt(breakEvenRate)}</strong> needed. Qualified leads (${pctFmt(qualRate)}) are the leading indicator to watch as the pipeline matures.`}
      </div>
      <div class="kpis" style="margin-top:4px;">
        ${card("Break-even conversion", breakEvenRate == null ? "--" : pctFmt(breakEvenRate), leadsPerSale == null ? "" : `1 sale per ${grp(leadsPerSale)} leads`, blue)}
        ${card("Mandate-won rate", pctFmt(mandateRate), `${grp(metaMandate)} of ${grp(metaN)} meta leads`, above ? green : yellow)}
        ${card("Qualified rate", pctFmt(qualRate), `${grp(metaQual)} warm / hot / mandate`)}
        ${card("Expected value / R80 lead", randS(evPerLead), `net ${randS(netEv)} · ${evMultiple.toFixed(1)}&times; on spend`, netEv >= 0 ? green : "#B91C1C")}
        ${card("Sales to break even", salesNeeded == null ? "--" : grp(Math.ceil(salesNeeded)), `on ${randS(metaSpend)} spend · ${grp(metaMandate)} mandates won`, above ? green : yellow)}
      </div>
      <p class="muted small" style="margin-top:10px;">
        Sale proxy = <strong>mandate won</strong> (Sole / Other Mandate). Fully-closed "Sold" is barely tracked in
        HubSpot (a couple of deals in the whole book), so mandate is the honest point commission is secured.
        Expected value = mandate rate &times; average commission; it does not discount mandates that never close.
      </p>
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
