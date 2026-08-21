// Overview view — KPIs (with sparklines + period deltas) + trend + mix + suburbs.
window.VIEWS = window.VIEWS || {};
window.VIEWS.overview = function (root, ctx) {
  const leads = ctx.view.leads;
  const { escapeHtml, pct, emptyState } = UTILS;

  if (!leads.length) {
    root.innerHTML = `<h2>Overview</h2><p class="lede">Showing 0 leads.</p>${emptyState()}`;
    return;
  }

  const now = new Date();
  const cutoff = (days) => { const d = new Date(now); d.setDate(now.getDate() - days); return d; };
  const c30 = cutoff(30), c60 = cutoff(60), c7 = cutoff(7), c14 = cutoff(14);
  const last30 = leads.filter(l => l.datestamp_d && l.datestamp_d >= c30).length;
  const prev30 = leads.filter(l => l.datestamp_d && l.datestamp_d >= c60 && l.datestamp_d < c30).length;
  const last7  = leads.filter(l => l.datestamp_d && l.datestamp_d >= c7).length;
  const prev7  = leads.filter(l => l.datestamp_d && l.datestamp_d >= c14 && l.datestamp_d < c7).length;
  const seller = leads.filter(l => l.is_lead === "Seller Lead").length;
  const hasDeal = leads.filter(l => l.has_deal).length;
  const worked = leads.filter(l => l.worked).length;

  // ── Cost per qualified lead (item: R80 per meta lead) ───────────────────
  // Spend = (# meta-sourced leads) × R80. A META lead is "qualified" once
  // its HubSpot deal reaches warm / hot / any mandate / sold. Cost per
  // qualified = meta spend ÷ qualified META leads (same population, so the
  // figure is honest and the % can't exceed 100). Matched source strings are
  // surfaced so a wrong "meta" catch is obvious at a glance.
  // Meta = single canonical origin (Meta-sourced AND not auto-created by the
  // Dialfire pipe). A Meta-ad lead that the calling team dialled counts as
  // Dialfire, not Meta — so this population, its R80 spend and its commission
  // never double-count against Dialfire, and the Dialfire lead-source filter
  // correctly shows zero Meta leads. See STAGES.originOf.
  const metaLeads = leads.filter(l => STAGES.isMetaLead(l));
  const metaSpend = metaLeads.length * STAGES.META_COST_PER_LEAD;
  const qualifiedMeta = metaLeads.filter(l => STAGES.isQualified(l.current_stage));
  const costPerQualified = qualifiedMeta.length ? metaSpend / qualifiedMeta.length : null;
  const metaSourceNames = [...new Set(metaLeads.map(l => (l.source || "").trim()).filter(Boolean))];
  const rand0 = v => "R" + Math.round(v).toLocaleString();
  const overTarget = costPerQualified != null && costPerQualified > STAGES.QUALIFIED_TARGET_COST;

  // Confirmed commission from these Meta leads: trace each meta lead's HubSpot
  // deal to a PAID_OUT row in the sales register and sum the total agency
  // commission it banked (same match + figure as Lead P&L). Only meta leads in
  // the current date range are counted, so this moves with the filters above.
  const sales = (ctx.cache && ctx.cache.salesDeals) || [];
  const saleBy = new Map();
  for (const s of sales) {
    if (!s.matched_deal_id) continue;
    const k = String(s.matched_deal_id);
    const prev = saleBy.get(k);
    if (!prev || (s.deal_status === "PAID_OUT" && prev.deal_status !== "PAID_OUT")) saleBy.set(k, s);
  }
  let metaConfirmedComm = 0;
  const metaSoldRows = [];
  for (const l of metaLeads) {
    const sale = l.deal_id ? saleBy.get(String(l.deal_id)) : null;
    if (sale && sale.deal_status === "PAID_OUT") {
      const comm = Number(sale.total_gross_comm) || 0;
      metaConfirmedComm += comm;
      metaSoldRows.push({
        // Where it came from: the marketing source label (Meta - ig / fb).
        source: (l.source || "").trim() || "Meta",
        // Address: prefer the lead's property address, else the register street.
        address: (l.property_address || `${sale.street_number || ""} ${sale.street_name || ""}`.trim() || "—"),
        suburb: (sale.suburb || l.suburb || "").trim(),
        team: (sale.division_name || l.division || "—"),   // which team/division sold it
        agent: (sale.broker1_name || "—"),                 // listing/selling broker
        entered: l.datestamp_d ? l.datestamp_d.toISOString().slice(0, 10) : "—",
        transfer: sale.transfer_date ? String(sale.transfer_date).slice(0, 10) : null,
        price: sale.purchase_price != null ? Number(sale.purchase_price) : null,
        commPct: sale.commission_pct != null ? Number(sale.commission_pct) : null,
        comm,                                              // full total agency commission
        quayComm: Number(sale.quay1_gross_comm) || 0,      // Quay-retained (~half)
        dealId: l.deal_id || "",
      });
    }
  }
  metaSoldRows.sort((a, b) => b.comm - a.comm);
  const metaSoldCount = metaSoldRows.length;

  // ── Farming area (item: out-of-area = unqualified) ──────────────────────
  // A lead is out of area when its suburb isn't in the farmed set (or it's in
  // HubSpot's "Not My Area" stage). "Deals created" that count = has a deal
  // AND is in area. Falls back to a hint until the division-area sheet loads.
  const areaKnown = leads.some(l => l.in_farming_area != null);
  const outOfArea = leads.filter(l => l.out_of_area).length;
  const dealsInArea = leads.filter(l => l.has_deal && !l.out_of_area).length;

  function deltaPill(curr, prev) {
    if (!prev) return "";
    const change = curr - prev;
    const pctChange = (change / prev * 100);
    const cls = change > 0 ? "up" : change < 0 ? "down" : "flat";
    const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "■";
    return `<span class="delta ${cls}">${arrow} ${Math.abs(pctChange).toFixed(0)}% vs prev</span>`;
  }

  function kpiCard(label, value, delta, sparkId) {
    const v = (typeof value === "number") ? value.toLocaleString() : value;
    return `<div class="kpi">
      <div class="label">${label}</div>
      <div class="value">${v}</div>
      ${delta ? `<div class="delta-row">${delta}</div>` : ""}
      ${sparkId ? `<div class="spark" id="${sparkId}"></div>` : ""}
    </div>`;
  }

  root.innerHTML = `
    <h2>Overview</h2>
    <p class="lede">${leads.length.toLocaleString()} leads match the current filters.</p>

    <div class="kpis">
      ${kpiCard("Leads in view", leads.length, "", "spark-total")}
      ${kpiCard("Last 30 days", last30, deltaPill(last30, prev30))}
      ${kpiCard("Last 7 days", last7, deltaPill(last7, prev7))}
      ${kpiCard("Seller leads", seller, pct(seller, leads.length))}
      ${kpiCard("Has deal", hasDeal, pct(hasDeal, leads.length))}
      ${kpiCard("Worked", worked, pct(worked, leads.length))}
    </div>

    <section class="card" style="margin-top: 16px;">
      <h3>Cost per qualified lead</h3>
      <p class="section-caption">
        Meta leads costed at <strong>${rand0(STAGES.META_COST_PER_LEAD)}</strong> each.
        <em>Qualified</em> = deal reached warm, hot, any mandate, or sold.
        Reference target: <strong>${rand0(STAGES.QUALIFIED_TARGET_COST)}</strong> per qualified lead.
      </p>
      <div class="kpis" style="margin-top: 4px;">
        ${kpiCard("Meta leads", metaLeads.length, `× ${rand0(STAGES.META_COST_PER_LEAD)} = ${rand0(metaSpend)} spend`)}
        ${kpiCard("Qualified meta leads", qualifiedMeta.length, pct(qualifiedMeta.length, metaLeads.length))}
        <div class="kpi" style="border-left:4px solid ${overTarget ? "#B91C1C" : THEME.tokens.green};">
          <div class="label">Cost per qualified lead</div>
          <div class="value">${costPerQualified == null ? "—" : rand0(costPerQualified)}</div>
          <div class="delta-row muted small">${costPerQualified == null ? "no qualified leads yet" : (overTarget ? "over target" : "on/under target")}</div>
        </div>
        <div class="kpi${metaSoldCount ? " kpi-clickable" : ""}" id="meta-comm-card" style="border-left:4px solid ${THEME.tokens.green};"${metaSoldCount ? ' role="button" tabindex="0" title="Click for a breakdown of the deals that sold"' : ""}>
          <div class="label">Confirmed commission (Meta)</div>
          <div class="value">${metaSoldCount ? rand0(metaConfirmedComm) : "—"}</div>
          <div class="delta-row muted small">${metaSoldCount ? `${metaSoldCount} sold &amp; paid · total agency commission &nbsp;·&nbsp; <span class="link-cue">view breakdown →</span>` : "no Meta leads banked yet"}</div>
        </div>
      </div>
      <p class="muted small" style="margin-top: 10px;">
        Counted as meta from source: ${metaSourceNames.length ? metaSourceNames.map(s => `<code>${escapeHtml(s)}</code>`).join(" ") : "<em>none matched — tell me the exact Meta source label</em>"}
      </p>
    </section>

    <section class="card" style="margin-top: 16px;">
      <h3>Farming area</h3>
      <p class="section-caption">
        Leads outside our farmed suburbs (the division-area breakdown) are <strong>unqualified</strong>.
        <em>Deals created</em> counts only deals inside the farming area.
      </p>
      ${areaKnown ? `
      <div class="kpis" style="margin-top: 4px;">
        ${kpiCard("Deals created (in area)", dealsInArea, pct(dealsInArea, hasDeal || 1) + " of all deals")}
        <div class="kpi" style="border-left:4px solid #B91C1C;">
          <div class="label">Out of area (unqualified)</div>
          <div class="value">${outOfArea.toLocaleString()}</div>
          <div class="delta-row muted small">${pct(outOfArea, leads.length)}</div>
        </div>
      </div>` : `
      <div class="kpi" style="margin-top: 4px; border-left:4px solid ${THEME.tokens.yellowDeep};">
        <div class="label">Not enabled yet</div>
        <div class="value" style="font-size: 15px; font-weight: 600;">Awaiting suburb map</div>
        <div class="delta-row muted small">Load the division-area breakdown sheet (farming_areas) to switch this on.</div>
      </div>`}
    </section>

    <div class="grid-2">
      <section class="card">
        <h3>Leads over time</h3>
        <p class="section-caption">Top 5 sources by volume; everything else grouped as <em>Other</em>.</p>
        <div id="trend-chart" style="height: 360px;"></div>
      </section>
      <section class="card">
        <h3>Lead mix</h3>
        <div id="mix-chart" style="height: 360px;"></div>
      </section>
    </div>

    <div class="grid-2" style="margin-top: 16px;">
      <section class="card">
        <h3>Top suburbs</h3>
        <div id="suburb-chart" style="height: 400px;"></div>
      </section>
      <section class="card">
        <h3>Needs attention</h3>
        <p class="muted">Unworked leads with no HubSpot deal.</p>
        <div class="kpi" style="margin-top: 12px;">
          <div class="label">Backlog</div>
          <div class="value">${leads.filter(l => !l.has_deal && !l.worked).length.toLocaleString()}</div>
        </div>
        <p class="muted" style="margin-top: 12px;">
          Work them in <a href="#/action-tracker">Action Tracker</a>.
        </p>
      </section>
    </div>
  `;

  // ── Confirmed-commission (Meta) breakdown modal ────────────────────────────
  // Click the card → a modal listing every Meta lead that reached a paid sale:
  // where it came from, the address, which team/agent closed it, when the lead
  // entered, and what it banked. Read-only; closes on backdrop, ✕ or Esc.
  (() => {
    const card = document.getElementById("meta-comm-card");
    if (!card || !metaSoldCount) return;

    const grp = n => Math.round(Number(n) || 0).toLocaleString();
    const randS = v => "R" + grp(v);
    const sourcePill = src => {
      const s = src.toLowerCase();
      const c = s.includes("ig") || s.includes("insta") ? "#C13584"
              : (s.includes("fb") || s.includes("facebook") ? "#1877F2" : THEME.tokens.yellowDeep);
      return `<span class="pill" style="background:${c}22;color:${c};">${escapeHtml(src)}</span>`;
    };
    const rowHtml = r => `<tr>
      <td>${sourcePill(r.source)}</td>
      <td><strong>${escapeHtml(r.address)}</strong>${r.suburb ? `<div class="muted small">${escapeHtml(r.suburb)}</div>` : ""}</td>
      <td>${escapeHtml(r.team)}</td>
      <td>${escapeHtml(r.agent)}</td>
      <td class="num">${escapeHtml(r.entered)}</td>
      <td class="num">${r.price != null ? randS(r.price) : "—"}${r.commPct != null ? `<div class="muted small">${r.commPct}%</div>` : ""}</td>
      <td class="num"><strong style="color:${THEME.tokens.green};">${randS(r.comm)}</strong></td>
      <td class="num muted">${randS(r.quayComm)}</td>
      <td>${r.dealId ? `<a href="${UTILS.hsDealLink(r.dealId)}" target="_blank" rel="noopener">Open ↗</a>` : ""}</td>
    </tr>`;

    const rangeLbl = (FILTERS && FILTERS.state && (FILTERS.state.range === "all" ? "all dates"
      : (FILTERS.state.from && FILTERS.state.to
          ? `${FILTERS.state.from.toISOString().slice(0,10)} → ${FILTERS.state.to.toISOString().slice(0,10)}`
          : "current range"))) || "current range";

    function openModal() {
      if (document.getElementById("meta-comm-modal")) return;
      const wrap = document.createElement("div");
      wrap.className = "modal-overlay";
      wrap.id = "meta-comm-modal";
      wrap.innerHTML = `
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="Confirmed Meta commission breakdown">
          <div class="modal-head">
            <div>
              <h3 style="margin:0;">Confirmed commission (Meta) — breakdown</h3>
              <p class="muted small" style="margin:4px 0 0;">
                ${grp(metaSoldCount)} Meta lead${metaSoldCount === 1 ? "" : "s"} traced to a paid sale ·
                <strong>${randS(metaConfirmedComm)}</strong> total agency commission ·
                ${escapeHtml(rangeLbl)}
              </p>
            </div>
            <button class="modal-close" aria-label="Close" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <div class="table-wrap"><table class="dt">
              <thead><tr>
                <th>Source</th><th>Address</th><th>Team</th><th>Agent</th>
                <th class="num">Lead entered</th><th class="num">Sale price</th>
                <th class="num">Commission</th><th class="num">Quay keeps</th><th></th>
              </tr></thead>
              <tbody>${metaSoldRows.map(rowHtml).join("")}</tbody>
            </table></div>
            <p class="muted small" style="margin-top:10px;">
              "Meta" here means the lead's marketing source was Meta and its deal was <em>not</em> auto-created by the
              Dialfire calling pipe. "Commission" is the full agency fee the deal generated; "Quay keeps" is the
              retained share after the broker split. Only sales matched to a paid row in the register are shown.
            </p>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
      const onKey = e => { if (e.key === "Escape") close(); };
      wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
      wrap.querySelector(".modal-close").addEventListener("click", close);
      document.addEventListener("keydown", onKey);
    }

    card.addEventListener("click", openModal);
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openModal(); } });
  })();

  // Total-volume sparkline on the first KPI card
  (() => {
    const dayCounts = {};
    for (const l of leads) {
      if (!l.datestamp_d) continue;
      const k = l.datestamp_d.toISOString().slice(0, 10);
      dayCounts[k] = (dayCounts[k] || 0) + 1;
    }
    const days = Object.keys(dayCounts).sort();
    if (!days.length) return;
    Plotly.newPlot("spark-total", [{
      type: "scatter", mode: "lines",
      x: days, y: days.map(d => dayCounts[d]),
      line: { color: THEME.tokens.yellow, width: 2 },
      fill: "tozeroy", fillcolor: "rgba(253,197,3,0.18)",
      hovertemplate: "%{x}<br>%{y} leads<extra></extra>",
    }], {
      paper_bgcolor: "transparent", plot_bgcolor: "transparent",
      margin: { l: 0, r: 0, t: 0, b: 0 },
      xaxis: { visible: false }, yaxis: { visible: false },
      showlegend: false, hovermode: "x",
      height: 36,
    }, { displayModeBar: false, responsive: true });
  })();

  // Lead-over-time stacked area — Top 5 + Other (rather than 10+ striped layers)
  const sourceTotals = {};
  for (const l of leads) {
    const k = l.source || "(unknown)";
    sourceTotals[k] = (sourceTotals[k] || 0) + 1;
  }
  const top5 = Object.entries(sourceTotals)
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(p => p[0]);
  const bucket = (src) => top5.includes(src) ? src : "Other";

  const byDay = new Map();
  for (const l of leads) {
    if (!l.datestamp_d) continue;
    const day = l.datestamp_d.toISOString().slice(0, 10);
    const src = bucket(l.source || "(unknown)");
    const key = `${day}|${src}`;
    byDay.set(key, (byDay.get(key) || 0) + 1);
  }
  const days = Array.from(new Set(Array.from(byDay.keys()).map(k => k.split("|")[0]))).sort();
  const series = [...top5, "Other"];
  const traces = series.map(src => ({
    type: "scatter", mode: "lines", stackgroup: "one",
    name: src,
    x: days,
    y: days.map(d => byDay.get(`${d}|${src}`) || 0),
    hovertemplate: "%{y} %{fullData.name}<extra></extra>",
  }));
  Plotly.newPlot("trend-chart", traces,
    { ...THEME.PLOTLY_LAYOUT, hovermode: "x unified", showlegend: true },
    THEME.PLOTLY_CONFIG);

  // Mix donut
  const mix = {};
  for (const l of leads) {
    const k = l.is_lead || "Unclassified";
    mix[k] = (mix[k] || 0) + 1;
  }
  Plotly.newPlot("mix-chart", [{
    type: "pie", hole: 0.55,
    labels: Object.keys(mix), values: Object.values(mix),
    textposition: "outside", textinfo: "label+percent",
  }], { ...THEME.PLOTLY_LAYOUT, showlegend: false, margin: { t: 10, b: 10, l: 10, r: 10 } },
     THEME.PLOTLY_CONFIG);

  // Suburb bar
  const subs = {};
  for (const l of leads) {
    const s = (l.suburb || "").trim();
    if (!s || s.length > 40) continue;
    subs[s] = (subs[s] || 0) + 1;
  }
  const subPairs = Object.entries(subs).sort((a, b) => b[1] - a[1]).slice(0, 15);
  Plotly.newPlot("suburb-chart", [{
    type: "bar", orientation: "h",
    y: subPairs.map(p => p[0]).reverse(),
    x: subPairs.map(p => p[1]).reverse(),
    marker: { color: THEME.tokens.yellow },
  }], { ...THEME.PLOTLY_LAYOUT, xaxis: { ...THEME.PLOTLY_LAYOUT.xaxis, title: "Leads" }, margin: { l: 140, r: 24, t: 24, b: 40 } },
     THEME.PLOTLY_CONFIG);
};
