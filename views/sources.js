// Sources view - whole-book channel breakdown + sheet channel quality + mix over time.
window.VIEWS = window.VIEWS || {};
window.VIEWS.sources = function (root, ctx) {
  const leads = ctx.view.leads;
  const { escapeHtml, trunc, emptyState, pct } = UTILS;

  // ── Whole-book channel breakdown (hs_deals_all) ───────────────────────────
  // Real Dialfire + Broker (+ SLB) figures come from the whole HubSpot deal book,
  // not the Seller Lead Bank sheet. Same helpers + scope as the All Leads view
  // and the Overview whole-book section, so the three reconcile. Super/admin only
  // (RLS-gated; empty for everyone else -> section hidden).
  const hsDeals = (ctx.cache && ctx.cache.allDeals) || [];
  const wbAvail = hsDeals.length > 0;
  const fstate = (window.FILTERS && FILTERS.state) || {};
  const _origin = fstate.leadOrigin || null;   // null | 'dialfire' | 'slb' | 'team'
  const RENTAL_STAGES = new Set(["Rental Lead", "Referred to Rentals"]);
  const NURTURE = (window.STAGES && STAGES.NURTURE) || "Contacted - Lead to Nurture";
  const wbIsWorked = (d) => d.stage_label === NURTURE;
  const wbIsRental = (d) => RENTAL_STAGES.has(d.stage_label);
  function wbChannel(d) {
    if (d.source) return d.source;
    if (d.source_label === "CRM_UI") return "team";
    if (d.source_label === "INTEGRATION") return "dialfire";
    return "other";
  }
  const wbTeamOf = (d) => ((wbChannel(d) === "team" && d.created_by_team) ? d.created_by_team : d.team) || null;
  const teamLc = (fstate.divisions && fstate.divisions.size)
    ? new Set([...fstate.divisions].map((x) => (x || "").toLowerCase())) : null;
  const inRange = (d) => d && (!fstate.from || d >= fstate.from) && (!fstate.to || d <= fstate.to);
  const wbInScope = (d) =>
    inRange(d.createdate_d) &&
    (!teamLc || teamLc.has((wbTeamOf(d) || "").toLowerCase()));
  const wbCap = (s) => (s || "").replace(/(^|[\s_])\w/g, (c) => c.toUpperCase()).replace(/_/g, " ");
  const CHAN_LABEL = { dialfire: "Dialfire", team: "Broker deals", slb: "Seller Lead Bank", other: "Other" };

  // Build the whole-book breakdown section (empty string when unavailable). When
  // the sidebar is on All, it is a channel-vs-channel summary; when it is a
  // specific channel (Dialfire / Broker / SLB) it is a by-team breakdown for that
  // channel. Deals excludes rentals (own line); Worked = reached Lead to Nurture
  // (stage_label === NURTURE), Worked % = worked / deals - matches the All Leads view.
  function wholeBookSection() {
    if (!wbAvail) return "";
    const scoped = hsDeals.filter(wbInScope);

    if (_origin === null) {
      const order = ["dialfire", "team", "slb", "other"];
      const agg = {};
      for (const k of order) agg[k] = { deals: 0, worked: 0, rentals: 0 };
      for (const d of scoped) {
        const a = agg[wbChannel(d)] || agg.other;
        if (wbIsRental(d)) { a.rentals++; }
        else { a.deals++; if (wbIsWorked(d)) a.worked++; }
      }
      const body = order.filter((k) => agg[k].deals || agg[k].rentals).map((k) => {
        const a = agg[k];
        return `<tr>
          <td>${CHAN_LABEL[k]}</td>
          <td class="num">${a.deals.toLocaleString()}</td>
          <td class="num">${a.worked.toLocaleString()}</td>
          <td class="num">${a.rentals.toLocaleString()}</td>
          <td>${pct(a.worked, a.deals)}</td>
        </tr>`;
      }).join("");
      return `
        <section class="card">
          <h3>Channel breakdown (whole book)</h3>
          <p class="section-caption">Every deal created in HubSpot over the current date range and divisions, split by channel - Dialfire and Broker deals included (these never reach the Seller Lead Bank sheet below). <strong>Deals</strong> excludes rentals (their own line); <strong>Worked</strong> = reached Lead to Nurture.</p>
          <div class="table-wrap">
            <table class="dt">
              <thead><tr><th>Channel</th><th class="num">Deals</th><th class="num">Worked</th><th class="num">Rentals</th><th>Worked %</th></tr></thead>
              <tbody>${body || `<tr><td colspan="5" class="muted" style="padding:14px;">No deals in range.</td></tr>`}</tbody>
            </table>
          </div>
        </section>`;
    }

    // Specific channel: by-team breakdown.
    const label = CHAN_LABEL[_origin] || "Channel";
    const chanDeals = scoped.filter((d) => wbChannel(d) === _origin);
    const teamAgg = new Map();
    for (const d of chanDeals) {
      const t = wbTeamOf(d) || "(unassigned)";
      let a = teamAgg.get(t);
      if (!a) { a = { deals: 0, worked: 0, rentals: 0 }; teamAgg.set(t, a); }
      if (wbIsRental(d)) { a.rentals++; }
      else { a.deals++; if (wbIsWorked(d)) a.worked++; }
    }
    const trows = [...teamAgg.entries()]
      .map(([t, a]) => ({ team: t, ...a }))
      .sort((x, y) => y.deals - x.deals || y.worked - x.worked);
    const body = trows.map((r) => `<tr>
      <td>${escapeHtml(wbCap(r.team))}</td>
      <td class="num">${r.deals.toLocaleString()}</td>
      <td class="num">${r.worked.toLocaleString()}</td>
      <td class="num">${r.rentals.toLocaleString()}</td>
      <td>${pct(r.worked, r.deals)}</td>
    </tr>`).join("");
    return `
      <section class="card">
        <h3>${label} by team</h3>
        <p class="section-caption">Whole-book HubSpot deals in the <strong>${label}</strong> channel over the current date range and divisions, by attributed team (broker deals by their creator, Dialfire/SLB by owner). <strong>Deals</strong> excludes rentals; <strong>Worked</strong> = reached Lead to Nurture.</p>
        <div class="table-wrap">
          <table class="dt">
            <thead><tr><th>Team</th><th class="num">Deals</th><th class="num">Worked</th><th class="num">Rentals</th><th>Worked %</th></tr></thead>
            <tbody>${body || `<tr><td colspan="5" class="muted" style="padding:14px;">No ${label} deals in range.</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
  }

  // Sheet leads can be empty while the whole book has data (e.g. the sidebar is on
  // Dialfire or Broker deals, which have ~no sheet rows). Only bail out entirely
  // when there is nothing at all to show.
  const sheetEmpty = !leads.length;
  if (sheetEmpty && !wbAvail) {
    root.innerHTML = `<h2>Sources</h2>${emptyState()}`;
    return;
  }

  // The sheet-based marketing-source detail (Channel quality + mix/trend charts)
  // only describes the SLB/Meta sheet book, so it is shown for All / Seller Lead
  // Bank and hidden for the whole-book-only Dialfire / Broker channels (which
  // have ~no sheet rows) - the whole-book section above covers those instead.
  const showSheet = !sheetEmpty && (_origin === null || _origin === "slb");

  // Sheet channel-quality rows (by marketing source). Computed only when shown.
  let rows = [];
  if (showSheet) {
    const bySrc = {};
    for (const l of leads) {
      const k = STAGES.canonicalSource(l.source);
      if (!bySrc[k]) bySrc[k] = { total: 0, seller: 0, owner: 0, hasDeal: 0, worked: 0 };
      bySrc[k].total++;
      if (l.is_lead === "Seller Lead") bySrc[k].seller++;
      if (l.is_lead === "Owner")       bySrc[k].owner++;
      if (l.has_deal) bySrc[k].hasDeal++;
      if (l.worked)   bySrc[k].worked++;
    }
    rows = Object.entries(bySrc).map(([src, s]) => ({
      src, ...s,
      dealPct: s.total ? (s.hasDeal / s.total * 100) : 0,
      workedPct: s.total ? (s.worked / s.total * 100) : 0,
    })).sort((a, b) => b.total - a.total);
  }

  const qualitySection = showSheet ? `
    <section>
      <h3>Channel quality (Seller Lead Bank sheet)</h3>
      <p class="section-caption">Per marketing source on the Seller Lead Bank sheet - the SLB / Meta inbound detail. Dialfire and Broker figures are in the whole-book section above.</p>
      <div class="table-wrap">
        <table class="dt">
          <thead><tr>
            <th>Source</th>
            <th class="num">Total</th>
            <th class="num">Seller</th>
            <th class="num">Owner</th>
            <th class="num">Has Deal</th>
            <th class="num">Worked</th>
            <th>Deal %</th>
            <th>Worked %</th>
          </tr></thead>
          <tbody>${rows.map((r) => `
            <tr>
              <td>${escapeHtml(r.src)}</td>
              <td class="num">${r.total.toLocaleString()}</td>
              <td class="num">${r.seller.toLocaleString()}</td>
              <td class="num">${r.owner.toLocaleString()}</td>
              <td class="num">${r.hasDeal.toLocaleString()}</td>
              <td class="num">${r.worked.toLocaleString()}</td>
              <td>${barCell(r.dealPct, classifyPct(r.dealPct))}</td>
              <td>${barCell(r.workedPct, classifyPct(r.workedPct))}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h3>Source mix over time</h3>
      <div id="mix-time-chart" style="height: 420px;"></div>
    </section>

    <section class="card">
      <h3>Per-source weekly trend (top 6)</h3>
      <div id="per-source-chart" style="height: 540px;"></div>
    </section>` : "";

  // Render order: for Seller Lead Bank put the sheet Channel-quality table FIRST
  // (its by-source detail is what the user wants there, and the whole-book SLB
  // by-team table can run to 40+ rows and bury it). For All and the other
  // channels keep the whole-book section first.
  const wb = wholeBookSection();
  const ordered = (_origin === "slb") ? `${qualitySection}\n${wb}` : `${wb}\n${qualitySection}`;

  root.innerHTML = `
    <h2>Sources</h2>
    <p class="lede">Where leads come from, how they convert, and how the mix moves over time.</p>

    ${ordered}
  `;

  // Sheet charts (mix over time + per-source facets) only exist when the sheet
  // sections were rendered - skip them otherwise so Plotly never targets a
  // missing container.
  if (!showSheet) return;

  // Monthly stacked bar
  const monthly = {};
  for (const l of leads) {
    if (!l.datestamp_d) continue;
    const m = `${l.datestamp_d.getFullYear()}-${String(l.datestamp_d.getMonth() + 1).padStart(2, "0")}`;
    const k = `${m}|${STAGES.canonicalSource(l.source)}`;
    monthly[k] = (monthly[k] || 0) + 1;
  }
  const months = Array.from(new Set(Object.keys(monthly).map(k => k.split("|")[0]))).sort();
  const srcs = Array.from(new Set(leads.map(l => STAGES.canonicalSource(l.source)))).sort();
  const traces = srcs.map(src => ({
    type: "bar", name: src,
    x: months,
    y: months.map(m => monthly[`${m}|${src}`] || 0),
  }));
  Plotly.newPlot("mix-time-chart", traces,
    { ...THEME.PLOTLY_LAYOUT, barmode: "stack", legend: { ...THEME.PLOTLY_LAYOUT.legend } },
    THEME.PLOTLY_CONFIG);

  // Per-source small multiples - top 6
  const top6 = rows.slice(0, 6).map(r => r.src);
  const weekly = {};
  for (const l of leads) {
    const csrc = STAGES.canonicalSource(l.source);
    if (!l.datestamp_d || !top6.includes(csrc)) continue;
    const monday = new Date(l.datestamp_d);
    const day = monday.getDay();
    monday.setDate(monday.getDate() - ((day + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const w = monday.toISOString().slice(0, 10);
    const k = `${w}|${csrc}`;
    weekly[k] = (weekly[k] || 0) + 1;
  }
  const weeks = Array.from(new Set(Object.keys(weekly).map(k => k.split("|")[0]))).sort();
  const facetTraces = [];
  top6.forEach((src, i) => {
    facetTraces.push({
      type: "scatter", mode: "lines+markers",
      x: weeks, y: weeks.map(w => weekly[`${w}|${src}`] || 0),
      name: src, showlegend: false,
      xaxis: `x${i + 1}`, yaxis: `y${i + 1}`,
      line: { color: THEME.PALETTE[i % THEME.PALETTE.length] },
    });
  });
  const facetLayout = { ...THEME.PLOTLY_LAYOUT,
    grid: { rows: 2, columns: 3, pattern: "independent", roworder: "top to bottom" },
    annotations: top6.map((src, i) => ({
      // Use HTML <b> in text - Plotly doesn't support font.weight as a key
      text: `<b>${trunc(src, 24)}</b>`,
      showarrow: false,
      x: 0.5, y: 1.10, xref: `x${i + 1} domain`, yref: `y${i + 1} domain`,
      font: { size: 12, color: THEME.tokens.ink },
    })),
    margin: { l: 40, r: 16, t: 60, b: 40 },
  };
  // Cleaner axes for each facet
  for (let i = 0; i < top6.length; i++) {
    const ax = i === 0 ? "" : (i + 1);
    facetLayout[`xaxis${ax}`] = { ...THEME.PLOTLY_LAYOUT.xaxis, nticks: 3, matches: null };
    facetLayout[`yaxis${ax}`] = { ...THEME.PLOTLY_LAYOUT.yaxis, nticks: 3, matches: null };
  }
  Plotly.newPlot("per-source-chart", facetTraces, facetLayout, THEME.PLOTLY_CONFIG);
};

function classifyPct(p) { return p >= 75 ? "green" : p >= 50 ? "amber" : (p > 0 ? "red" : ""); }
function barCell(p, cls) {
  const w = Math.max(0, Math.min(100, p));
  return `<div class="bar ${cls}"><span style="width:${w}%"></span></div>
          <span class="muted small">${p.toFixed(1)}%</span>`;
}
