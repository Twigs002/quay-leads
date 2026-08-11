// Finance — one flowing money page for super/admin. Merges the old CFO,
// Costings and Actuals tabs into a single narrative, top to bottom:
//   1. At a glance      — the real headline numbers (banked commission, ROI)
//   2. What a lead costs — Meta R80, agency commission, cost per Dialfire lead
//   3. Break-even & EV   — the decision number (conversion needed vs actual)
//   4. Spend → projected — the suburb-value model (potential commission)
//   5. Live pipeline     — whole-book open value by stage (HubSpot)
//   6. Actuals           — real commission banked from the register
//   7. Suburb reference  — average sale price per suburb (collapsible)
// The suburb-value model and Dialfire economics used to be duplicated across
// CFO + Costings; the ROI/won-revenue headline appeared on all three with
// three different provenances. Here each is computed once and clearly labelled
// (modelled vs actual). Reads ctx.view.leads (filtered) for the lead-scoped
// sections and ctx.cache for the whole-book aggregates + register.
window.VIEWS = window.VIEWS || {};
window.VIEWS.finance = function (root, ctx) {
  // Gate: super/admin only (the tab is hidden otherwise, but re-check in body).
  if (!(ctx.user && (ctx.user.isSuper || ctx.user.isAdmin))) {
    root.innerHTML = `<h2>Finance</h2>
      <div class="card" style="padding:20px;"><p class="muted">This page is restricted to super and admin users.</p></div>`;
    return;
  }

  const { escapeHtml, pct } = UTILS;

  // ── Money formatters (one set, was three) ─────────────────────────────────
  const grp = n => Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const randS = v => "R " + grp(v);                       // full, SA-grouped (tables)
  const rand  = v => "R" + Math.round(Number(v) || 0).toLocaleString();
  const randC = v => {                                    // compact (KPI headline)
    v = Number(v) || 0;
    if (Math.abs(v) >= 1e6) return "R" + (v / 1e6).toFixed(Math.abs(v) >= 1e7 ? 0 : 1) + "m";
    if (Math.abs(v) >= 1e3) return "R" + Math.round(v / 1e3) + "k";
    return "R" + Math.round(v).toLocaleString();
  };
  const green = THEME.tokens.green, blue = THEME.tokens.blue, yellow = THEME.tokens.yellowDeep, red = "#B91C1C";

  // One KPI-tile helper (was copy-pasted as money()/card() in all three views).
  function card(label, value, sub, accent) {
    return `<div class="kpi"${accent ? ` style="border-left:4px solid ${accent};"` : ""}>
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${sub ? `<div class="delta-row muted small">${sub}</div>` : ""}
    </div>`;
  }

  const COST = STAGES.META_COST_PER_LEAD;    // R80
  const RATE = STAGES.COMMISSION_RATE;       // 0.042 total agency commission
  const ratePct = (RATE * 100).toFixed(1) + "%";
  const sumAmt = arr => arr.reduce((a, l) => a + (Number(l.amount) || 0), 0);

  const leads = (ctx.view && ctx.view.leads) || [];
  const allLeads = (ctx.cache && ctx.cache.leads) || leads;
  const SS = window.SUBURB_SALES;

  // ── Meta economics (filtered) ─────────────────────────────────────────────
  const metaLeads     = leads.filter(l => STAGES.isMetaSource(l.source));
  const metaN         = metaLeads.length;
  const metaSpend     = metaN * COST;
  const metaQualified = metaLeads.filter(l => STAGES.isQualified(l.current_stage));
  const metaMandate   = metaLeads.filter(l => STAGES.isWonListing(l.current_stage)).length;
  const metaWon       = metaLeads.filter(l => l.current_stage === STAGES.WON);
  const metaWonValue  = sumAmt(metaWon);
  const roi           = metaSpend ? metaWonValue / metaSpend : null;
  const metaSourceNames = [...new Set(metaLeads.map(l => (l.source || "").trim()).filter(Boolean))];

  // ── Suburb-value model — single pass over the filtered leads ──────────────
  // Feeds: (a) the all-leads matched table + potential pool, and (b) the meta
  // subset (flow strip, avg price/commission for break-even). One loop, was two
  // in Costings plus a third in CFO.
  const rowComm = r => (r && r.avg_comm != null) ? Number(r.avg_comm) : (Number(r && r.avg_price) || 0) * RATE;
  const groups = {};   // "Suburb|CODE" -> { row, leads, deals }
  let matchedLeads = 0, matchedDeals = 0;
  let matchedMeta = 0, potMetaComm = 0, potMetaDealComm = 0;
  let mSum = 0, mComm = 0, mCnt = 0;
  for (const l of leads) {
    const row = SS && SS.find ? SS.find(l.suburb, l.property_type) : null;
    if (!row) continue;
    matchedLeads++;
    if (l.has_deal) matchedDeals++;
    const key = row.suburb + "|" + row.type;
    (groups[key] || (groups[key] = { row, leads: 0, deals: 0 })).leads++;
    if (l.has_deal) groups[key].deals++;
    if (STAGES.isMetaSource(l.source)) {
      const c = rowComm(row);
      matchedMeta++; potMetaComm += c;
      mSum += Number(row.avg_price) || 0; mComm += c; mCnt++;
      if (l.has_deal) potMetaDealComm += c;
    }
  }
  const groupRows = Object.values(groups).sort((a, b) => b.leads - a.leads);
  const potentialPool = groupRows.reduce((a, g) => a + g.leads * rowComm(g.row), 0);
  const dealPool = groupRows.reduce((a, g) => a + g.deals * rowComm(g.row), 0);
  const projReturn = metaSpend ? potMetaComm / metaSpend : null;

  // Reference average across all mapped rows (fallback when no meta match).
  const rows = (SS && SS.ROWS) || [];
  const weightedRows = rows.filter(r => Number(r.num_sales) > 0);
  const totSales = weightedRows.reduce((a, r) => a + Number(r.num_sales), 0);
  const refAvgPrice = totSales
    ? weightedRows.reduce((a, r) => a + (Number(r.avg_price) || 0) * Number(r.num_sales), 0) / totSales : 0;
  const avgSalePrice  = mCnt ? mSum / mCnt : refAvgPrice;
  const avgCommission = mCnt ? mComm / mCnt : refAvgPrice * RATE;

  // ── Break-even & expected value ───────────────────────────────────────────
  const breakEvenRate = avgCommission ? COST / avgCommission : null;
  const leadsPerSale  = avgCommission ? Math.round(avgCommission / COST) : null;
  const mandateRate   = metaN ? metaMandate / metaN : 0;
  const qualRate      = metaN ? metaQualified.length / metaN : 0;
  const evPerLead     = mandateRate * avgCommission;          // sale proxy = mandate won
  const netEv         = evPerLead - COST;
  const evMultiple    = COST ? evPerLead / COST : 0;
  const salesNeeded   = avgCommission ? metaSpend / avgCommission : null;
  const beMultiple    = (breakEvenRate && breakEvenRate > 0) ? mandateRate / breakEvenRate : null;
  const above         = beMultiple != null && beMultiple >= 1;
  const pctFmt = r => {
    const p = (r || 0) * 100;
    if (p === 0) return "0%";
    if (p < 0.1) return p.toFixed(3) + "%";
    if (p < 1)   return p.toFixed(2) + "%";
    return p.toFixed(1) + "%";
  };

  // ── Cost per Dialfire lead (whole book, last 3 complete months) ───────────
  const dfSalaries = STAGES.CALLER_SALARIES_MONTHLY;
  const dfCalling  = STAGES.CALLING_COST_MONTHLY;
  const dfMonthly  = STAGES.DIALFIRE_MONTHLY_COST;
  const dfAutoTotal = allLeads.filter(l => l.deal_creation === "auto").length;
  const dfByMonth = {}; const dfSeen = new Set();
  for (const l of allLeads) {
    if (l.deal_creation !== "auto" || !l.deal_created_d) continue;
    const id = l.deal_id || l.email;
    if (dfSeen.has(id)) continue;
    dfSeen.add(id);
    const d = l.deal_created_d;
    const k = d.getFullYear() * 12 + d.getMonth();
    dfByMonth[k] = (dfByMonth[k] || 0) + 1;
  }
  const _now = new Date();
  const curK = _now.getFullYear() * 12 + _now.getMonth();
  const dfLast3 = Object.keys(dfByMonth).map(Number).filter(k => k < curK).sort((a, b) => b - a).slice(0, 3);
  const dfLive = dfLast3.length ? Math.round(dfLast3.reduce((a, k) => a + dfByMonth[k], 0) / dfLast3.length) : 0;
  const dfLiveMeasured = dfLive > 0;
  const dfPerMonth = dfLive || STAGES.DIALFIRE_LEADS_PER_MONTH_FALLBACK;
  const costPerDf = dfPerMonth ? dfMonthly / dfPerMonth : null;
  const dfBreakEven = avgCommission && costPerDf != null ? costPerDf / avgCommission : null;
  const dfLeadsPerSale = costPerDf ? Math.round(avgCommission / costPerDf) : null;

  // ── Live pipeline value (whole-book aggregate) ────────────────────────────
  const TERMINAL = new Set([
    STAGES.WON, STAGES.LOST, "Let By Us", "Referred to Rentals",
    STAGES.OUT_OF_AREA, "Please delete (Provide note)", "Past Let - Leakage",
  ]);
  const withDeal = leads.filter(l => l.has_deal && l.current_stage);
  const openDeals = withDeal.filter(l => !TERMINAL.has(l.current_stage));
  const won  = leads.filter(l => l.current_stage === STAGES.WON);
  const lost = leads.filter(l => l.current_stage === STAGES.LOST);
  const weightedForecast = openDeals.reduce(
    (a, l) => a + (Number(l.amount) || 0) * (l.probability != null && !isNaN(l.probability) ? l.probability : 0), 0);

  const stageValue = (ctx.cache && ctx.cache.stageValue) || [];
  const haveSV = stageValue.length > 0;
  const openSV = stageValue.filter(r => r.is_open);
  const svByStage = label => stageValue.find(r => r.stage === label) || null;
  const svNum = (r, k) => (r ? Number(r[k]) || 0 : 0);
  const svGross = openSV.reduce((a, r) => a + svNum(r, "gross"), 0);
  const svWeighted = openSV.reduce((a, r) => a + svNum(r, "weighted"), 0);
  const svOpenCount = openSV.reduce((a, r) => a + (r.deal_count || 0), 0);
  const svWon = svByStage(STAGES.WON), svLost = svByStage(STAGES.LOST);

  const pipeVal   = haveSV ? svGross : sumAmt(openDeals);
  const pipeWtd   = haveSV ? svWeighted : weightedForecast;
  const pipeOpenN = haveSV ? svOpenCount : openDeals.length;
  const pipeWon   = haveSV && svWon ? svNum(svWon, "gross") : sumAmt(won);
  const pipeLost  = haveSV && svLost ? svNum(svLost, "gross") : sumAmt(lost);
  const pipeWonN  = haveSV && svWon ? (svWon.deal_count || 0) : won.length;
  const pipeLostN = haveSV && svLost ? (svLost.deal_count || 0) : lost.length;
  const pipeResolved = pipeWonN + pipeLostN;
  const pipeWinRate  = pipeResolved ? (pipeWonN / pipeResolved * 100) : 0;
  const svUpdated = haveSV ? (stageValue[0].updated_at || "") : "";

  // ── Actuals — real commission banked from the register ────────────────────
  const salesDeals = (ctx.cache && ctx.cache.salesDeals) || [];
  const haveReg = salesDeals.length > 0;
  const num = v => (v == null || v === "") ? 0 : (Number(v) || 0);
  const paid = salesDeals.filter(d => d.deal_status === "PAID_OUT");
  const salesPaid = paid.filter(d => !d.is_rental);
  const rentPaid  = paid.filter(d => d.is_rental);
  const regOpen   = salesDeals.filter(d => d.deal_status === "OPEN");
  const salesComm = salesPaid.reduce((a, d) => a + num(d.total_gross_comm), 0);
  const rentComm  = rentPaid.reduce((a, d) => a + num(d.total_gross_comm), 0);
  const soldValue = salesPaid.reduce((a, d) => a + num(d.purchase_price), 0);
  const avgCommPerSale = salesPaid.length ? salesComm / salesPaid.length : 0;
  const regOpenValue = regOpen.reduce((a, d) => a + num(d.purchase_price), 0);
  const regOpenComm  = regOpen.reduce((a, d) => a + num(d.total_gross_comm), 0);

  // Trailing-12-month cost vs return (real revenue, annualised cost).
  const cutoff = new Date(_now.getFullYear() - 1, _now.getMonth(), _now.getDate());
  const inT12 = d => d.deal_date_d && d.deal_date_d >= cutoff;
  const commT12 = paid.filter(inT12).reduce((a, d) => a + num(d.total_gross_comm), 0);
  const metaLeadsT12 = allLeads.filter(l => STAGES.isMetaSource(l.source) && l.datestamp_d && l.datestamp_d >= cutoff).length;
  const metaSpendT12 = metaLeadsT12 * COST;
  const dialfireT12  = dfMonthly * 12;
  const costT12      = metaSpendT12 + dialfireT12;
  const roiMultiple  = costT12 ? commT12 / costT12 : null;
  const netT12       = commT12 - costT12;
  const roiTone = roiMultiple == null ? blue : (roiMultiple >= 1 ? green : red);

  // Attribution: paid deals traced back to a lead we generated.
  const attributed = paid.filter(d => d.lead_matched);
  const attr = { dialfire: { n: 0, comm: 0 }, slb: { n: 0, comm: 0 } };
  const method = { phone: 0, name: 0, address: 0 };
  for (const d of attributed) {
    const o = d.lead_origin === "dialfire" ? "dialfire" : "slb";
    attr[o].n++; attr[o].comm += num(d.total_gross_comm);
    if (d.match_method && method[d.match_method] != null) method[d.match_method]++;
  }
  const attrComm = attr.dialfire.comm + attr.slb.comm;
  const bookComm = salesComm + rentComm;
  const attrPct = bookComm ? (100 * attrComm / bookComm) : 0;
  const dfCommT12  = attributed.filter(d => d.lead_origin === "dialfire" && inT12(d)).reduce((a, d) => a + num(d.total_gross_comm), 0);
  const slbCommT12 = attributed.filter(d => d.lead_origin !== "dialfire" && inT12(d)).reduce((a, d) => a + num(d.total_gross_comm), 0);
  const dfRoi   = dialfireT12 ? dfCommT12 / dialfireT12 : null;
  const metaRoi = metaSpendT12 ? slbCommT12 / metaSpendT12 : null;

  // By team + top suburbs (paid sales only).
  const teamMap = new Map();
  for (const d of salesPaid) {
    const t = d.division_name || "(none)";
    let g = teamMap.get(t);
    if (!g) { g = { team: t, n: 0, comm: 0, sold: 0 }; teamMap.set(t, g); }
    g.n++; g.comm += num(d.total_gross_comm); g.sold += num(d.purchase_price);
  }
  const teamRows = [...teamMap.values()].sort((a, b) => b.comm - a.comm);
  const subMap = new Map();
  for (const d of salesPaid) {
    const s = (d.suburb || "").trim();
    if (!s) continue;
    const key = s + "|" + (d.title_code || "?");
    let g = subMap.get(key);
    if (!g) { g = { suburb: s, type: d.title_code || "?", n: 0, comm: 0 }; subMap.set(key, g); }
    g.n++; g.comm += num(d.total_gross_comm);
  }
  const subRows = [...subMap.values()].sort((a, b) => b.comm - a.comm).slice(0, 12);

  // ── Suburb reference table ────────────────────────────────────────────────
  const naCell = v => (v == null || v === "") ? '<span class="muted">n/a</span>' : randS(v);
  const refCols = ["Team", "Suburb", "Type", `${(SS && SS.YEAR) || ""} Avg. Price`, "Total Spend", "No. of Sales",
    "Median Price", "Avg. R/m&sup2;", "Avg. Days on Market", "Avg. agency commission", "R80 leads / sale"];
  const refBody = rows.length
    ? rows.map(r => {
        const comm = rowComm(r);
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
    : `<tr><td colspan="${refCols.length}" class="muted" style="padding:18px;">No suburb data mapped yet.</td></tr>`;

  const matchBody = groupRows.length
    ? groupRows.map(g => {
        const commPer = rowComm(g.row);
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

  const teamBody = teamRows.map(g => `<tr>
      <td><strong>${escapeHtml(g.team)}</strong></td>
      <td class="num">${grp(g.n)}</td>
      <td class="num" style="color:${green}; font-weight:700;">${randS(g.comm)}</td>
      <td class="num">${randS(g.n ? g.comm / g.n : 0)}</td>
      <td class="num">${randS(g.sold)}</td>
    </tr>`).join("");
  const subBody = subRows.map(g => `<tr>
      <td><strong>${escapeHtml(g.suburb)}</strong></td>
      <td>${escapeHtml(g.type)}</td>
      <td class="num">${grp(g.n)}</td>
      <td class="num" style="color:${green}; font-weight:700;">${randS(g.comm)}</td>
      <td class="num">${randS(g.n ? g.comm / g.n : 0)}</td>
    </tr>`).join("");

  // ── Render ────────────────────────────────────────────────────────────────
  root.innerHTML = `
    <h2>Finance</h2>
    <p class="lede">The money view of the lead book, end to end — what leads cost, what they could earn, and what has actually been banked. Over the ${leads.length.toLocaleString()} leads in the current filters (the register + whole-book sections ignore the filters).</p>

    <section class="card" style="margin-top:16px;">
      <h3>At a glance</h3>
      <p class="section-caption">The real headline numbers first: commission actually banked and its return on the last 12 months of lead spend. ${haveReg ? "" : "<em>Register not loaded yet — showing modelled figures until the sync populates it.</em>"}</p>
      <div class="kpis" style="margin-top:4px;">
        ${card("Commission banked (12m)", randC(commT12), "sales + rentals, paid out", green)}
        ${card("Return on spend (12m)", roiMultiple == null ? "--" : roiMultiple.toFixed(1) + "&times;", `net ${randC(netT12)} · real revenue / lead cost`, roiTone)}
        ${card("Open pipeline value", randC(pipeVal), `${pipeOpenN.toLocaleString()} live deals${haveSV ? " · whole book" : ""}`, blue)}
        ${card("Lead spend (12m)", randC(costT12), `Dialfire ${randC(dialfireT12)} + Meta ${randC(metaSpendT12)}`, yellow)}
      </div>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>What a lead costs</h3>
      <p class="section-caption">
        The inputs behind every projection below. A <strong>Meta</strong> lead is a raw ${rand(COST)} inbound enquiry;
        a <strong>Dialfire</strong> lead is a deal the outbound calling pipe auto-creates (${grp(dfAutoTotal)} in the book),
        already human-qualified — its cost is the monthly calling spend &divide; deals produced${dfLiveMeasured
          ? `, averaged over the last ${dfLast3.length} complete month${dfLast3.length === 1 ? "" : "s"}`
          : ` (measured ${grp(dfPerMonth)}/mo until create dates sync)`}.
      </p>
      <div class="kpis" style="margin-top:4px;">
        ${card("Meta lead", randS(COST), "per Meta / Facebook lead", yellow)}
        ${card("Agency commission", ratePct, "total per sale (from the register)", blue)}
        ${card("Dialfire cost / month", randS(dfMonthly), `salaries ${randC(dfSalaries)} + calling ${randC(dfCalling)}`, yellow)}
        ${card("Dialfire leads / month", grp(dfPerMonth), dfLiveMeasured ? "live · last 3 complete months" : "measured estimate", blue)}
        ${card("Cost per Dialfire lead", costPerDf == null ? "--" : randS(costPerDf), `break-even at ${dfBreakEven == null ? "--" : pctFmt(dfBreakEven)} · 1 sale / ${dfLeadsPerSale == null ? "--" : grp(dfLeadsPerSale)} leads`, green)}
      </div>
      <p class="muted small" style="margin-top:10px;">
        Salaries (${randS(dfSalaries)}) and calling (${randS(dfCalling)}) are set assumptions — tell me the exact figures and I'll lock them in.
        Counted as Meta from source: ${metaSourceNames.length ? metaSourceNames.map(s => `<code>${escapeHtml(s)}</code>`).join(" ") : "<em>none matched — tell me the exact Meta source label.</em>"}
      </p>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Break-even &amp; expected value</h3>
      <p class="section-caption">
        The decision number: at <strong>${randS(COST)}</strong> a Meta lead and <strong>${randS(avgCommission)}</strong> commission on an
        average <strong>${randS(avgSalePrice)}</strong> sale (${ratePct}), we break even when just
        <strong>${breakEvenRate == null ? "--" : pctFmt(breakEvenRate)}</strong> of leads convert
        (about <strong>1 sale per ${leadsPerSale == null ? "--" : grp(leadsPerSale)} leads</strong>). Conversion below is measured from the ${grp(metaN)} Meta leads in view.
      </p>
      <div class="card" style="padding:14px 18px; margin:4px 0 12px; border-left:4px solid ${above ? green : yellow}; background:var(--paper, #f6f8fc);">
        ${metaN === 0
          ? `<strong>No Meta leads in the current view.</strong> Adjust the filters to see the break-even picture.`
          : above
            ? `<strong>Above break-even.</strong> Mandates won on Meta leads run at <strong>${pctFmt(mandateRate)}</strong>, which is
               <strong>${beMultiple.toFixed(1)}&times;</strong> the <strong>${pctFmt(breakEvenRate)}</strong> needed to cover the ${randS(metaSpend)} spent on Meta.
               Break-even is ${salesNeeded == null ? "--" : Math.ceil(salesNeeded)} sale(s); we have ${grp(metaMandate)} mandate(s) won.`
            : `<strong>Below break-even so far.</strong> Mandates won on Meta leads are <strong>${pctFmt(mandateRate)}</strong> versus the
               <strong>${pctFmt(breakEvenRate)}</strong> needed. Qualified leads (${pctFmt(qualRate)}) are the leading indicator to watch as the pipeline matures.`}
      </div>
      <div class="kpis" style="margin-top:4px;">
        ${card("Break-even conversion", breakEvenRate == null ? "--" : pctFmt(breakEvenRate), leadsPerSale == null ? "" : `1 sale per ${grp(leadsPerSale)} leads`, blue)}
        ${card("Mandate-won rate", pctFmt(mandateRate), `${grp(metaMandate)} of ${grp(metaN)} meta leads`, above ? green : yellow)}
        ${card("Qualified rate", pctFmt(qualRate), `${grp(metaQualified.length)} warm / hot / mandate`)}
        ${card("Expected value / R80 lead", randS(evPerLead), `net ${randS(netEv)} · ${evMultiple.toFixed(1)}&times; on spend`, netEv >= 0 ? green : red)}
        ${card("Sales to break even", salesNeeded == null ? "--" : grp(Math.ceil(salesNeeded)), `on ${randS(metaSpend)} spend · ${grp(metaMandate)} mandates won`, above ? green : yellow)}
      </div>
      <p class="muted small" style="margin-top:10px;">
        Sale proxy = <strong>mandate won</strong> (Sole / Other Mandate). Fully-closed "Sold" is barely tracked in HubSpot, so mandate is the honest point commission is secured.
      </p>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Spend vs projected commission</h3>
      <p class="section-caption">
        The modelled upside: each lead in view matched to its suburb + title type
        (<strong>House &rarr; FT</strong>, <strong>Apartment / Flat &rarr; ST</strong>) and valued at that suburb's real average total commission
        (about ${ratePct} of price). <strong>Potential</strong> assumes every matched lead converts, so it is an upper bound, not a forecast.
      </p>
      ${matchedMeta ? `
      <div class="model-flow card" style="display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:16px 18px; margin:4px 0 12px; background:var(--paper, #f6f8fc);">
        <span style="font-weight:800; font-size:20px; color:${yellow};">${randC(metaSpend)}</span>
        <span class="muted">spend on ${metaN.toLocaleString()} Meta leads</span>
        <span style="font-size:20px; color:var(--slate,#64748b);">&rarr;</span>
        <span class="muted">${matchedMeta.toLocaleString()} matched to a suburb value</span>
        <span style="font-size:20px; color:var(--slate,#64748b);">&rarr;</span>
        <span style="font-weight:800; font-size:20px; color:${green};">${randC(potMetaComm)}</span>
        <span class="muted">potential commission (${projReturn == null ? "--" : projReturn.toFixed(0) + "&times;"} on spend)</span>
      </div>` : ""}
      <div class="kpis" style="margin-top:4px;">
        ${card("Matched leads", grp(matchedLeads), `of ${grp(leads.length)} in view · ${grp(matchedDeals)} with a deal`, blue)}
        ${card("Potential commission pool", randS(potentialPool), "if every matched lead sold", green)}
        ${card("From matched deals", randS(dealPool), "if every matched deal sold", green)}
        ${card("Meta potential", randC(potMetaComm), matchedMeta ? `${matchedMeta.toLocaleString()} meta leads matched` : "no meta match yet", green)}
      </div>
      <div class="table-wrap" style="margin-top:12px;"><table class="dt">
        <thead><tr>
          <th>Team</th><th>Suburb</th><th>Type</th>
          <th class="num">Matched leads</th><th class="num">With deal</th>
          <th class="num">Avg sale price</th><th class="num">Commission / sale</th><th class="num">Potential pool</th>
        </tr></thead>
        <tbody>${matchBody}</tbody>
      </table></div>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Live pipeline value (whole book)</h3>
      <p class="section-caption">
        <strong>Open pipeline</strong> is the gross value of every deal still in play across the sales pipeline; <strong>weighted forecast</strong>
        multiplies each open deal by its HubSpot win probability.${haveSV ? ` Whole deal book, <strong>not</strong> narrowed by the filters${svUpdated ? `, refreshed ${escapeHtml(String(svUpdated).slice(0, 10))}` : ""}.` : " <em>Awaiting the first whole-book aggregate from the sync; showing seller-lead deals only for now.</em>"}
      </p>
      <div class="kpis" style="margin-top:4px;">
        ${card("Open pipeline", randC(pipeVal), `${pipeOpenN.toLocaleString()} live deals`, blue)}
        ${card("Weighted forecast", randC(pipeWtd), "probability-adjusted", green)}
        ${card("Won revenue", randC(pipeWon), `${pipeWonN.toLocaleString()} sold`, green)}
        ${card("Lost to competitor", randC(pipeLost), `${pipeLostN.toLocaleString()} listed elsewhere`, red)}
        ${card("Win rate", pipeWinRate.toFixed(0) + "%", `${pipeResolved.toLocaleString()} resolved`)}
      </div>
      <div style="margin-top:12px;">
        <h4 style="margin:0 0 4px;">Pipeline value by stage</h4>
        <p class="section-caption">Gross against probability-weighted value, per open stage${haveSV ? " (whole book)" : ""}.</p>
        <div id="fin-stage-chart" style="height:400px;"></div>
      </div>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Actuals — real commission banked</h3>
      <p class="section-caption">Straight from the deal &amp; commission register (${grp(paid.length)} paid-out deals). Quay retains about half of the total agency commission to cover overheads and the broker split.</p>
      ${haveReg ? `
      <div class="kpis" style="margin-top:4px;">
        ${card("Sales commission", randS(salesComm), `${grp(salesPaid.length)} sales paid out`, green)}
        ${card("Rentals commission", randS(rentComm), `${grp(rentPaid.length)} rentals paid out`, green)}
        ${card("Avg commission / sale", randS(avgCommPerSale), "real, per paid-out sale", blue)}
        ${card("Property sold", randC(soldValue), "total purchase price transacted", blue)}
        ${card("Open (register)", randC(regOpenComm), `${grp(regOpen.length)} open · ${randC(regOpenValue)} value`, yellow)}
      </div>

      <div class="grid-2" style="margin-top:16px;">
        <div>
          <h4 style="margin:0 0 4px;">Commission banked by month</h4>
          <p class="section-caption">Total agency commission on paid-out deals, by deal month.</p>
          <div id="fin-month-chart" style="height:340px;"></div>
        </div>
        <div>
          <h4 style="margin:0 0 4px;">Sales vs rentals</h4>
          <p class="section-caption">Share of banked commission.</p>
          <div id="fin-split-chart" style="height:340px;"></div>
        </div>
      </div>

      <div style="margin-top:16px;">
        <h4 style="margin:0 0 4px;">Cost vs return &amp; attribution (last 12 months)</h4>
        <p class="section-caption">
          Real commission banked in the last 12 months against annualised lead cost, then the slice we can trace back to a lead we generated
          (by seller phone / name / address at sync time). Only <strong>${grp(attributed.length)}</strong> of ${grp(paid.length)} paid deals
          (<strong>${attrPct.toFixed(0)}%</strong> of banked commission) are traceable. Matches: ${grp(method.phone)} phone, ${grp(method.name)} name, ${grp(method.address)} address.
        </p>
        <div class="kpis" style="margin-top:4px;">
          ${card("Commission banked (12m)", randS(commT12), "sales + rentals, paid out", green)}
          ${card("Lead cost (12m)", randS(costT12), `Dialfire ${randC(dialfireT12)} + Meta ${randC(metaSpendT12)}`, yellow)}
          ${card("Return on spend", roiMultiple == null ? "--" : roiMultiple.toFixed(1) + "&times;", `net ${randS(netT12)}`, roiTone)}
          ${card("Dialfire return (12m)", dfRoi == null ? "--" : dfRoi.toFixed(1) + "&times;", `${randC(dfCommT12)} vs ${randC(dialfireT12)} cost`, dfRoi != null && dfRoi >= 1 ? green : yellow)}
          ${card("Meta return (12m, soft)", metaRoi == null ? "--" : metaRoi.toFixed(1) + "&times;", `SLB ${randC(slbCommT12)} vs Meta ${randC(metaSpendT12)}`, metaRoi != null && metaRoi >= 1 ? green : yellow)}
        </div>
        <p class="muted small" style="margin-top:10px;">
          Blends real revenue with cost assumptions, so read the ROI as directional. Attribution is a floor: it only counts sales where the seller is identifiable in our lead data.
        </p>
      </div>

      <div class="grid-2" style="margin-top:16px;">
        <div>
          <h4 style="margin:0 0 4px;">By team</h4>
          <p class="section-caption">Paid-out sales commission per division (rentals excluded).</p>
          <div class="table-wrap"><table class="dt">
            <thead><tr><th>Team</th><th class="num">Sales</th><th class="num">Commission banked</th>
              <th class="num">Avg / sale</th><th class="num">Property sold</th></tr></thead>
            <tbody>${teamBody || `<tr><td colspan="5" class="muted" style="padding:18px;">No paid sales yet.</td></tr>`}</tbody>
          </table></div>
        </div>
        <div>
          <h4 style="margin:0 0 4px;">Top suburbs by commission</h4>
          <p class="section-caption">Where the banked commission comes from (paid-out sales).</p>
          <div class="table-wrap"><table class="dt">
            <thead><tr><th>Suburb</th><th>Type</th><th class="num">Sales</th>
              <th class="num">Commission banked</th><th class="num">Avg / sale</th></tr></thead>
            <tbody>${subBody || `<tr><td colspan="5" class="muted" style="padding:18px;">No paid sales yet.</td></tr>`}</tbody>
          </table></div>
        </div>
      </div>` : `
      <div class="card" style="margin-top:4px; padding:20px;">
        <p class="muted">No sales-register rows loaded yet. This populates once the <code>sales_register</code> migration is applied
        and the register sheet is shared with the sync service account. It refreshes on the 30-minute sync.</p>
      </div>`}
    </section>

    <details class="card" style="margin-top:16px; padding:16px 20px;">
      <summary style="cursor:pointer; font-weight:700; color:var(--ink);">Suburb reference table${SS && SS.PLACEHOLDER ? ` &middot; <span class="pill" style="background:#FEF3C7;color:#92400E;">placeholder</span>` : ""}</summary>
      <p class="section-caption" style="margin-top:10px;">
        Real suburb averages from the commission register. <strong>Avg. agency commission</strong> is the actual average total commission per sale there
        (falling back to ${ratePct} of price for any suburb not yet mapped). FT = Freehold Title (houses), ST = Sectional Title (apartments / flats / townhouses).
      </p>
      <div class="table-wrap"><table class="dt">
        <thead><tr>${refCols.map((c, i) => `<th${i >= 3 ? ' class="num"' : ""}>${c}</th>`).join("")}</tr></thead>
        <tbody>${refBody}</tbody>
      </table></div>
    </details>
  `;

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
  } else {
    const el = document.getElementById("fin-stage-chart");
    if (el) el.innerHTML = '<p class="muted" style="padding:24px 8px;">No open deals carry a value yet. Deal amounts are entered on a minority of HubSpot deals; the whole-book total refreshes with the next sync.</p>';
  }

  // ── Chart: commission banked by month (real, last 24 months) ──────────────
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
    } else {
      const el = document.getElementById("fin-month-chart");
      if (el) el.innerHTML = '<p class="muted" style="padding:24px 8px;">No dated deals to chart yet.</p>';
    }

    // ── Chart: sales vs rentals donut ───────────────────────────────────────
    if (salesComm > 0 || rentComm > 0) {
      Plotly.newPlot("fin-split-chart", [{
        type: "pie", hole: 0.55,
        labels: ["Sales", "Rentals"], values: [salesComm, rentComm],
        marker: { colors: [THEME.tokens.blue, THEME.tokens.yellowDeep] },
        textinfo: "label+percent",
        hovertemplate: "%{label}<br>R%{value:,.0f}<extra></extra>",
      }], { ...THEME.PLOTLY_LAYOUT, margin: { l: 16, r: 16, t: 16, b: 16 }, showlegend: false }, THEME.PLOTLY_CONFIG);
    } else {
      const el = document.getElementById("fin-split-chart");
      if (el) el.innerHTML = '<p class="muted" style="padding:24px 8px;">No commission to split yet.</p>';
    }
  }
};
