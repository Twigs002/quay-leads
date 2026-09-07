// Meta 12-month report — Facebook + Instagram leads: where they sit in the
// pipeline and whether they've sold. Self-contained trailing-12-month window
// built from the WHOLE book (ctx.cache.leads), so it ignores the sidebar date
// range on purpose — it always reports the last 12 months. Division/source
// scoping still comes from RLS server-side (super/admin see all; a team member
// sees only their team's rows).
window.VIEWS = window.VIEWS || {};
window.VIEWS["meta-report"] = function (root, ctx) {
  const { escapeHtml, emptyState, pct, hsDealLink } = UTILS;

  // ── Platform classification ────────────────────────────────────────
  // Real sheet Source values in play: "Meta - fb", "Meta - ig", "fb", "ig".
  // Match loosely but word-bounded so "signage" etc. never false-match "ig".
  const isFB = (s) => /\b(facebook|fb)\b/i.test(s || "");
  const isIG = (s) => /\b(instagram|ig)\b/i.test(s || "");
  const platformOf = (l) => isFB(l.source) ? "Facebook" : isIG(l.source) ? "Instagram" : null;

  const money = (v) => v ? "R" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";
  const localBar = (p) => {
    const cls = p >= 75 ? "green" : p >= 50 ? "amber" : (p > 0 ? "red" : "");
    const w = Math.max(0, Math.min(100, p));
    return `<div class="bar ${cls}"><span style="width:${w}%"></span></div><span class="muted small">${p.toFixed(1)}%</span>`;
  };

  // ── Trailing 12-month window (12 monthly buckets ending this month) ──
  const now = new Date();
  const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthKeys = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    monthKeys.push(monthKeyOf(d));
  }
  const monthSet = new Set(monthKeys);
  const monthLabel = (key) => {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1)
      .toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  };
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const windowLabel = `${windowStart.toLocaleDateString("en-GB", { month: "short", year: "numeric" })} – ${now.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`;

  // Whole book, not the sidebar-filtered view. Keep only Meta leads whose
  // datestamp falls inside one of the 12 buckets (drops stray future/old dates).
  const all = (ctx.cache && ctx.cache.leads) || ctx.view.leads;
  const leads = all.filter((l) => {
    const p = platformOf(l);
    if (!p) return false;
    if (!l.datestamp_d) return false;
    return monthSet.has(monthKeyOf(l.datestamp_d));
  });
  leads.forEach((l) => { l._platform = platformOf(l); });

  const matchedSources = Array.from(new Set(leads.map((l) => l.source).filter(Boolean))).sort();

  if (!leads.length) {
    root.innerHTML = `<h2>Meta 12-month report</h2>` +
      emptyState("No Facebook or Instagram leads in the last 12 months.");
    return;
  }

  // ── Aggregates ─────────────────────────────────────────────────────
  const isQual = (l) => STAGES.isQualified(l.current_stage);
  const isMandate = (l) => STAGES.isMandate(l.current_stage);
  const isSold = (l) => l.current_stage === STAGES.WON;                 // actual "Sold"
  const isWon = (l) => STAGES.isWonListing(l.current_stage);            // mandate OR sold
  const isLost = (l) => STAGES.isLost(l.current_stage);                 // competitor

  function summarise(rows) {
    return {
      leads: rows.length,
      hasDeal: rows.filter((l) => l.has_deal).length,
      worked: rows.filter((l) => l.worked).length,
      qualified: rows.filter(isQual).length,
      mandate: rows.filter(isMandate).length,
      sold: rows.filter(isSold).length,
      won: rows.filter(isWon).length,
      lost: rows.filter(isLost).length,
    };
  }
  const fb = leads.filter((l) => l._platform === "Facebook");
  const ig = leads.filter((l) => l._platform === "Instagram");
  const T = summarise(leads), F = summarise(fb), I = summarise(ig);

  // ── Stage distribution (where they are now) ────────────────────────
  const NO_DEAL = "No deal yet";
  const byStage = {};
  for (const l of leads) {
    const s = l.has_deal && l.current_stage ? l.current_stage : NO_DEAL;
    byStage[s] = (byStage[s] || 0) + 1;
  }
  const stageOrder = Object.keys(byStage)
    .filter((s) => s !== NO_DEAL)
    .sort((a, b) => STAGES.orderIndex(a) - STAGES.orderIndex(b))
    .concat(byStage[NO_DEAL] ? [NO_DEAL] : []);
  const stageCmap = THEME.stageColors(stageOrder);

  // ── Won-listing + sold detail rows (the outcomes that matter) ──────
  const outcomeRank = (l) => isSold(l) ? 0 : (l.current_stage === "Listed - Sole Mandate" ? 1 : 2);
  const outcomes = leads.filter(isWon).sort((a, b) =>
    outcomeRank(a) - outcomeRank(b) ||
    (b.datestamp || "").localeCompare(a.datestamp || ""));

  // ── Monthly volume, split FB / IG ──────────────────────────────────
  const mv = { Facebook: {}, Instagram: {} };
  for (const l of leads) mv[l._platform][monthKeyOf(l.datestamp_d)] =
    (mv[l._platform][monthKeyOf(l.datestamp_d)] || 0) + 1;

  // ── Render ─────────────────────────────────────────────────────────
  const perfRow = (name, s, colour) => `
    <tr>
      <td>${colour ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colour};margin-right:8px;vertical-align:middle;"></span>` : ""}${escapeHtml(name)}</td>
      <td class="num">${s.leads.toLocaleString()}</td>
      <td class="num">${s.hasDeal.toLocaleString()}</td>
      <td class="num">${s.worked.toLocaleString()}</td>
      <td class="num">${s.qualified.toLocaleString()}</td>
      <td class="num">${s.mandate.toLocaleString()}</td>
      <td class="num">${s.sold.toLocaleString()}</td>
      <td>${localBar(s.leads ? s.hasDeal / s.leads * 100 : 0)}</td>
      <td>${localBar(s.leads ? s.qualified / s.leads * 100 : 0)}</td>
    </tr>`;

  root.innerHTML = `
    <h2>Meta 12-month report</h2>
    <p class="lede">Facebook and Instagram leads over the last 12 months — where they sit in the pipeline now, and which ones won a mandate or sold.</p>
    <p class="section-caption">
      Window: <strong>${escapeHtml(windowLabel)}</strong> (trailing 12 months, whole book — this report ignores the sidebar date range on purpose).
      Counted as Meta from source: ${matchedSources.map((s) => `<span class="pill">${escapeHtml(s)}</span>`).join(" ")}.
      <strong>Sold</strong> = HubSpot <em>Sold</em> stage · <strong>Won listing</strong> = a Sole/Other Mandate or Sold (the realistic point commission is secured; almost nothing reaches <em>Sold</em> in HubSpot).
    </p>

    <div class="kpis">
      <div class="kpi" style="border-left:4px solid ${THEME.tokens.blue};">
        <div class="label">Meta leads (12 mo)</div>
        <div class="value">${T.leads.toLocaleString()}</div>
        <div class="delta-row muted small">${F.leads.toLocaleString()} FB · ${I.leads.toLocaleString()} IG</div>
      </div>
      <div class="kpi">
        <div class="label">Have a HubSpot deal</div>
        <div class="value">${T.hasDeal.toLocaleString()}</div>
        <div class="delta-row muted small">${pct(T.hasDeal, T.leads)} of leads</div>
      </div>
      <div class="kpi">
        <div class="label">Worked (call logged)</div>
        <div class="value">${T.worked.toLocaleString()}</div>
        <div class="delta-row muted small">${pct(T.worked, T.leads)} of leads</div>
      </div>
      <div class="kpi" style="border-left:4px solid ${THEME.tokens.warmAmber};">
        <div class="label">Qualified</div>
        <div class="value">${T.qualified.toLocaleString()}</div>
        <div class="delta-row muted small">${pct(T.qualified, T.leads)} · warm/hot/mandate/sold</div>
      </div>
      <div class="kpi" style="border-left:4px solid ${THEME.tokens.yellowDeep};">
        <div class="label">Won listing (mandate+sold)</div>
        <div class="value">${T.won.toLocaleString()}</div>
        <div class="delta-row muted small">${pct(T.won, T.leads)} of leads</div>
      </div>
      <div class="kpi" style="border-left:4px solid ${THEME.tokens.green};">
        <div class="label">Sold (HubSpot)</div>
        <div class="value">${T.sold.toLocaleString()}</div>
        <div class="delta-row muted small">${T.lost.toLocaleString()} lost to competitor</div>
      </div>
    </div>

    <section>
      <h3>Facebook vs Instagram</h3>
      <p class="section-caption"><strong>Deal %</strong> = has a HubSpot deal ÷ leads. <strong>Qual %</strong> = reached warm, hot, a mandate, or sold.</p>
      <div class="table-wrap">
        <table class="dt">
          <thead><tr>
            <th>Platform</th>
            <th class="num">Leads</th><th class="num">Deals</th><th class="num">Worked</th>
            <th class="num">Qualified</th><th class="num">Mandate</th><th class="num">Sold</th>
            <th>Deal %</th><th>Qual %</th>
          </tr></thead>
          <tbody>
            ${perfRow("Facebook", F, THEME.PALETTE[0])}
            ${perfRow("Instagram", I, THEME.PALETTE[1])}
            <tr style="font-weight:700; border-top:2px solid var(--line);">
              <td>Total</td>
              <td class="num">${T.leads.toLocaleString()}</td>
              <td class="num">${T.hasDeal.toLocaleString()}</td>
              <td class="num">${T.worked.toLocaleString()}</td>
              <td class="num">${T.qualified.toLocaleString()}</td>
              <td class="num">${T.mandate.toLocaleString()}</td>
              <td class="num">${T.sold.toLocaleString()}</td>
              <td>${localBar(T.leads ? T.hasDeal / T.leads * 100 : 0)}</td>
              <td>${localBar(T.leads ? T.qualified / T.leads * 100 : 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h3>Monthly lead volume</h3>
      <p class="section-caption">Facebook vs Instagram leads received per month across the 12-month window.</p>
      <div id="meta-monthly-chart" style="height: 380px;"></div>
    </section>

    <section class="card">
      <h3>Where they are now</h3>
      <p class="section-caption">Current HubSpot stage for all ${T.leads.toLocaleString()} Meta leads in the window, in pipeline order. <strong>No deal yet</strong> = never converted to a HubSpot deal.</p>
      <div id="meta-stage-chart" style="height: ${Math.max(360, 30 * stageOrder.length + 80)}px;"></div>
    </section>

    <section>
      <h3>Won listings &amp; sales</h3>
      <p class="section-caption">Every Meta lead that reached a mandate or sold in the window — ${outcomes.length.toLocaleString()} in total. This is the "did they sell" answer.</p>
      <div class="table-wrap">
        <table class="dt">
          <thead><tr>
            <th>Outcome</th><th>Client / address</th><th>Suburb</th>
            <th>Platform</th><th>Division</th><th class="num">Value</th>
            <th>Lead date</th><th class="num">HubSpot</th>
          </tr></thead>
          <tbody>${outcomes.map((l) => {
            const stage = l.current_stage;
            const oc = isSold(l) ? "Sold" : stage === "Listed - Sole Mandate" ? "Sole Mandate" : "Other Mandate";
            const ocColour = isSold(l) ? THEME.tokens.green : THEME.tokens.yellowDeep;
            const who = l.property_address
              ? escapeHtml(l.property_address)
              : (l.client_name ? escapeHtml(l.client_name) : (l.deal_name ? escapeHtml(l.deal_name) : "(no address)"));
            const date = l.datestamp_d ? l.datestamp_d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
            const link = l.deal_id
              ? `<a href="${hsDealLink(l.deal_id)}" target="_blank" rel="noopener">Open ↗</a>`
              : `<span class="muted">—</span>`;
            return `<tr>
              <td><span class="pill" style="background:${ocColour}1A; color:${ocColour}; border-color:${ocColour}55;">${oc}</span></td>
              <td>${who}</td>
              <td>${escapeHtml(l.suburb || "—")}</td>
              <td>${escapeHtml(l._platform)}</td>
              <td>${escapeHtml(l.division || "—")}</td>
              <td class="num">${money(l.amount)}</td>
              <td>${date}</td>
              <td class="num">${link}</td>
            </tr>`;
          }).join("") || `<tr><td colspan="8" class="muted" style="padding:14px;">No mandates or sales from Meta leads in the last 12 months.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;

  // Monthly volume — grouped bars, FB vs IG.
  Plotly.newPlot("meta-monthly-chart", [
    { type: "bar", name: "Facebook", x: monthKeys.map(monthLabel),
      y: monthKeys.map((k) => mv.Facebook[k] || 0), marker: { color: THEME.PALETTE[0] } },
    { type: "bar", name: "Instagram", x: monthKeys.map(monthLabel),
      y: monthKeys.map((k) => mv.Instagram[k] || 0), marker: { color: THEME.PALETTE[1] } },
  ], { ...THEME.PLOTLY_LAYOUT, barmode: "group",
       yaxis: { ...THEME.PLOTLY_LAYOUT.yaxis, title: "Leads" } }, THEME.PLOTLY_CONFIG);

  // Where they are — horizontal stage bar, chronological top→bottom.
  Plotly.newPlot("meta-stage-chart", [{
    type: "bar", orientation: "h",
    y: stageOrder.map((s) => s).reverse(),
    x: stageOrder.map((s) => byStage[s]).reverse(),
    text: stageOrder.map((s) => byStage[s].toLocaleString()).reverse(),
    textposition: "auto",
    marker: { color: stageOrder.map((s) => stageCmap[s]).reverse() },
    hovertemplate: "%{y}<br>%{x} leads<extra></extra>",
  }], { ...THEME.PLOTLY_LAYOUT, margin: { l: 220, r: 24, t: 24, b: 40 },
        xaxis: { ...THEME.PLOTLY_LAYOUT.xaxis, title: "Leads" } }, THEME.PLOTLY_CONFIG);
};
