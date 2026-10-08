// All Leads view — the company-wide bank of every lead (deal) created in HubSpot.
//
// Source of truth is hs_deals_all (the whole default-pipeline deal book by
// createdate, super/admin only), NOT the lead sheet — so this is every lead that
// comes into the company, not just sheet-captured ones.
//
// Definitions (single source: stages.js):
//   • Lead         = any deal created in the period.
//   • Worked lead  = deal in "Contacted - Lead to Nurture" (STAGES.NURTURE).
//                    This is the headline "worked-lead" count the business tracks
//                    (e.g. Sept 2026 ≈ 1,032). Rentals/commercial deals never
//                    reach this stage, so it is naturally sales-only.
//   • Rentals      = deal in "Rental Lead" / "Referred to Rentals" — shown as its
//                    own line, never folded into the worked count.
//   • Channel      = dialfire | team | slb | other (hs_deals_all.source, set by
//                    sync.py). Team-created deals attribute to their CREATOR's
//                    team (created_by_team); everything else to the owner's team.
window.VIEWS = window.VIEWS || {};
window.VIEWS["all-leads"] = function (root, ctx) {
  const { escapeHtml, pct, emptyState } = UTILS;
  const T = (window.THEME && THEME.tokens) || {};

  const RENTAL_STAGES = new Set(["Rental Lead", "Referred to Rentals"]);
  const NURTURE = (window.STAGES && STAGES.NURTURE) || "Contacted - Lead to Nurture";
  const WARM = (window.STAGES && STAGES.WARM) || "Contacted - Warm Lead (Courtesy)";
  const HOT = (window.STAGES && STAGES.HOT) || "Contacted - Hot Lead";
  const isWorked = (d) => d.stage_label === NURTURE;
  const isRental = (d) => RENTAL_STAGES.has(d.stage_label);
  const isMandate = (d) => window.STAGES ? STAGES.isMandate(d.stage_label) : false;
  // Channel: prefer the stored `source`; fall back to the raw source_label so the
  // view still splits sensibly on an older sync that predates the `source` column.
  function channel(d) {
    if (d.source) return d.source;
    if (d.source_label === "CRM_UI") return "team";
    if (d.source_label === "INTEGRATION") return "dialfire";
    return "other";
  }
  // Attributed team: team-created deals belong to their creator's team; Dialfire /
  // SLB deals to the owning team.
  const teamOf = (d) => ((channel(d) === "team" && d.created_by_team) ? d.created_by_team : d.team) || null;

  const allDeals = (ctx.cache && ctx.cache.allDeals) || [];
  if (!allDeals.length) {
    root.innerHTML = `<h2>All Leads</h2>
      <p class="lede">The company-wide bank of every lead created in HubSpot.</p>
      ${emptyState("No whole-book deal data yet. This view is super/admin only and needs the hs_deals_all sync to have run.")}`;
    return;
  }

  // ── Sidebar scope: honour the date range + division filter (same as Overview) ──
  const fstate = (window.FILTERS && FILTERS.state) || {};
  const teamLc = (fstate.divisions && fstate.divisions.size)
    ? new Set([...fstate.divisions].map((x) => (x || "").toLowerCase())) : null;
  const inRange = (d) => d && (!fstate.from || d >= fstate.from) && (!fstate.to || d <= fstate.to);
  const deals = allDeals.filter((d) =>
    inRange(d.createdate_d) && (!teamLc || teamLc.has((teamOf(d) || "").toLowerCase())));

  // Split rentals out of the "sales" book up front — they are their own line.
  const rentals = deals.filter(isRental);
  const sales = deals.filter((d) => !isRental(d));

  const total = deals.length;
  const worked = sales.filter(isWorked).length;
  const warm = sales.filter((d) => d.stage_label === WARM).length;
  const hot = sales.filter((d) => d.stage_label === HOT).length;
  const mandate = sales.filter(isMandate).length;

  // Channel split (sales only — rentals are their own bucket).
  const chanCounts = { dialfire: 0, slb: 0, team: 0, other: 0 };
  for (const d of sales) chanCounts[channel(d)] = (chanCounts[channel(d)] || 0) + 1;
  const sourceKnown = sales.some((d) => d.source || d.source_label);

  // ── Monthly series (last 12 complete-ish months by createdate) ────────────
  const byMonth = new Map(); // "YYYY-MM" -> {total, worked, rental, dialfire, slb, team, other}
  for (const d of allDeals) {
    if (!d.createdate_d) continue;
    if (teamLc && !teamLc.has((teamOf(d) || "").toLowerCase())) continue;
    const key = d.createdate_d.toISOString().slice(0, 7);
    let m = byMonth.get(key);
    if (!m) { m = { total: 0, worked: 0, rental: 0, dialfire: 0, slb: 0, team: 0, other: 0 }; byMonth.set(key, m); }
    m.total++;
    if (isRental(d)) { m.rental++; }
    else {
      if (isWorked(d)) m.worked++;
      m[channel(d)] = (m[channel(d)] || 0) + 1;
    }
  }
  const months = [...byMonth.keys()].sort().slice(-12);
  const monthLabel = (k) => {
    const [y, mo] = k.split("-");
    return new Date(Date.UTC(+y, +mo - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  };
  // Latest fully-complete month (not the current, still-filling one) for the caption.
  const nowKey = new Date().toISOString().slice(0, 7);
  const completeMonths = months.filter((k) => k < nowKey);
  const lastComplete = completeMonths.length ? completeMonths[completeMonths.length - 1] : null;
  const lastWorked = lastComplete ? byMonth.get(lastComplete).worked : null;

  const rand = (n) => n.toLocaleString();
  function kpiCard(label, value, sub, accent) {
    const style = accent ? ` style="border-left:4px solid ${accent};"` : "";
    return `<div class="kpi"${style}>
      <div class="label">${label}</div>
      <div class="value">${typeof value === "number" ? value.toLocaleString() : value}</div>
      ${sub ? `<div class="delta-row"><span class="muted small">${sub}</span></div>` : ""}
    </div>`;
  }

  root.innerHTML = `
    <h2>All Leads</h2>
    <p class="lede">${rand(total)} leads created in the selected range — every lead into the company.</p>
    <p class="muted small" style="margin-top:-6px;">
      One row per HubSpot deal, dated by deal <strong>createdate</strong> (whole book, not just the Seller Lead Bank sheet).
      <strong>Worked lead</strong> = reached <em>Contacted - Lead to Nurture</em>${lastComplete
        ? ` — ${rand(lastWorked)} in ${monthLabel(lastComplete)}` : ""}. Rentals are counted separately.
    </p>

    <div class="kpis">
      ${kpiCard("Leads in view", total, "all channels, incl. rentals")}
      ${kpiCard("Worked leads", worked, pct(worked, total) + " · Lead to Nurture", T.green)}
      ${kpiCard("Rentals", rentals.length, pct(rentals.length, total) + " · own line", T.skyDeep || T.blue)}
      ${kpiCard("Warm", warm, "Warm Lead (Courtesy)")}
      ${kpiCard("Hot", hot, "Hot Lead")}
      ${kpiCard("Mandates", mandate, "Listed - Sole/Other")}
    </div>

    <section class="card" style="margin-top:16px;">
      <h3>By channel${sourceKnown ? "" : " <span class=\"muted small\">(source split pending next sync)</span>"}</h3>
      <p class="section-caption">Where each lead came into the company. Sales book only — rentals shown separately above.</p>
      <div class="kpis" style="margin-top:4px;">
        ${kpiCard("Dialfire", chanCounts.dialfire, "cold-call pipe", T.blue)}
        ${kpiCard("Team created", chanCounts.team, "broker-created (CRM)", T.yellowDeep)}
        ${kpiCard("Seller Lead Bank", chanCounts.slb, "inbound on the sheet", T.green)}
        ${chanCounts.other ? kpiCard("Other", chanCounts.other, "uncategorised") : ""}
      </div>
      <div id="al-channel-chart" style="height:280px; margin-top:12px;"></div>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Monthly leads</h3>
      <p class="section-caption">Total leads created per month, with the worked-lead (Lead to Nurture) line. Last 12 months.</p>
      <div id="al-monthly-chart" style="height:340px;"></div>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>By team</h3>
      <p class="section-caption">Attributed team — team-created deals by their creator, Dialfire/SLB by owner. Rentals excluded.</p>
      <div id="al-team-table"></div>
    </section>
  `;

  // ── Charts ────────────────────────────────────────────────────────────────
  const LAYOUT = (window.THEME && THEME.PLOTLY_LAYOUT) || {};
  const CONFIG = (window.THEME && THEME.PLOTLY_CONFIG) || { displayModeBar: false, responsive: true };
  const col = { dialfire: T.blue || "#3D5BA6", team: T.yellowDeep || "#D9A400",
                slb: T.green || "#2E9E5B", other: T.noDealGrey || "#9CA3AF" };

  // Channel donut (sales book, selected range).
  if (sourceKnown && (chanCounts.dialfire + chanCounts.team + chanCounts.slb + chanCounts.other) > 0) {
    const labels = ["Dialfire", "Team created", "Seller Lead Bank", "Other"];
    const vals = [chanCounts.dialfire, chanCounts.team, chanCounts.slb, chanCounts.other];
    const colors = [col.dialfire, col.team, col.slb, col.other];
    Plotly.newPlot("al-channel-chart", [{
      type: "pie", hole: 0.55, labels, values: vals, marker: { colors },
      textinfo: "label+percent", sort: false,
    }], { ...LAYOUT, showlegend: false, margin: { t: 10, b: 10, l: 10, r: 10 } }, CONFIG);
  } else {
    document.getElementById("al-channel-chart").innerHTML =
      '<p class="muted small" style="padding:24px 8px;">Channel split appears once the next sync backfills the deal source.</p>';
  }

  // Monthly stacked bars by channel + worked-lead line.
  const x = months.map(monthLabel);
  const chKeys = ["dialfire", "team", "slb", "other"];
  const chName = { dialfire: "Dialfire", team: "Team created", slb: "Seller Lead Bank", other: "Other" };
  const traces = chKeys.map((k) => ({
    type: "bar", name: chName[k], x, y: months.map((mk) => byMonth.get(mk)[k] || 0),
    marker: { color: col[k] },
  }));
  // Rentals as a faint top band so the "all leads" total is complete.
  traces.push({ type: "bar", name: "Rentals", x, y: months.map((mk) => byMonth.get(mk).rental || 0),
    marker: { color: T.warmAmber || "#E8A13A" } });
  traces.push({ type: "scatter", mode: "lines+markers", name: "Worked (Nurture)",
    x, y: months.map((mk) => byMonth.get(mk).worked || 0),
    line: { color: T.ink || "#1F2937", width: 2 }, marker: { size: 5 } });
  Plotly.newPlot("al-monthly-chart", traces,
    { ...LAYOUT, barmode: "stack", hovermode: "x unified", showlegend: true,
      legend: { ...(LAYOUT.legend || {}), orientation: "h", y: -0.18 } }, CONFIG);

  // Per-team table (sales only), sorted by worked desc.
  const teamAgg = new Map();
  for (const d of sales) {
    const t = teamOf(d) || "(unassigned)";
    let a = teamAgg.get(t);
    if (!a) { a = { total: 0, worked: 0 }; teamAgg.set(t, a); }
    a.total++;
    if (isWorked(d)) a.worked++;
  }
  const rentalByTeam = new Map();
  for (const d of rentals) {
    const t = teamOf(d) || "(unassigned)";
    rentalByTeam.set(t, (rentalByTeam.get(t) || 0) + 1);
  }
  const rows = [...teamAgg.entries()]
    .map(([t, a]) => ({ team: t, total: a.total, worked: a.worked, rentals: rentalByTeam.get(t) || 0 }))
    .sort((x1, y1) => y1.worked - x1.worked || y1.total - x1.total);
  const cap = (s) => (s || "").replace(/(^|[\s_])\w/g, (c) => c.toUpperCase()).replace(/_/g, " ");
  const tbody = rows.map((r) => `<tr>
    <td>${escapeHtml(cap(r.team))}</td>
    <td class="num">${r.total.toLocaleString()}</td>
    <td class="num">${r.worked.toLocaleString()}</td>
    <td class="num">${r.rentals.toLocaleString()}</td>
    <td class="num">${pct(r.worked, r.total)}</td>
  </tr>`).join("");
  document.getElementById("al-team-table").innerHTML = rows.length ? `
    <div class="table-wrap"><table class="dt">
      <thead><tr><th>Team</th><th class="num">Leads</th><th class="num">Worked</th><th class="num">Rentals</th><th class="num">Worked %</th></tr></thead>
      <tbody>${tbody}</tbody>
    </table></div>` : emptyState("No teams in range.");
};
