// Overview view — KPIs + lead trend + mix + top suburbs.
window.VIEWS = window.VIEWS || {};
window.VIEWS.overview = function (root, ctx) {
  const leads = ctx.view.leads;
  const now = new Date();
  const cutoff = (days) => { const d = new Date(now); d.setDate(now.getDate() - days); return d; };
  const c30 = cutoff(30), c7 = cutoff(7);
  const last30 = leads.filter(l => l.datestamp_d && l.datestamp_d >= c30).length;
  const last7  = leads.filter(l => l.datestamp_d && l.datestamp_d >= c7).length;
  const seller = leads.filter(l => l.is_lead === "Seller Lead").length;
  const hasDeal = leads.filter(l => l.has_deal).length;
  const worked = leads.filter(l => l.worked).length;
  const pct = (n, d) => d ? `${(n / d * 100).toFixed(1)}%` : "—";

  root.innerHTML = `
    <h2>Overview</h2>
    <p class="lede">${leads.length.toLocaleString()} leads match the current filters.</p>

    <div class="kpis">
      ${kpiCard("Leads in view", leads.length)}
      ${kpiCard("Last 30 days", last30)}
      ${kpiCard("Last 7 days", last7)}
      ${kpiCard("Seller leads", seller, pct(seller, leads.length))}
      ${kpiCard("Has deal", hasDeal, pct(hasDeal, leads.length))}
      ${kpiCard("Worked", worked, pct(worked, leads.length))}
    </div>

    <div class="grid-2">
      <section class="card">
        <h3>Leads over time</h3>
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

  // Lead-over-time (stacked area by source)
  const byDay = new Map();
  for (const l of leads) {
    if (!l.datestamp_d) continue;
    const day = l.datestamp_d.toISOString().slice(0, 10);
    const key = `${day}|${l.source || "(unknown)"}`;
    byDay.set(key, (byDay.get(key) || 0) + 1);
  }
  const days = Array.from(new Set(Array.from(byDay.keys()).map(k => k.split("|")[0]))).sort();
  const sources = Array.from(new Set(leads.map(l => l.source || "(unknown)"))).sort();
  const traces = sources.map(src => ({
    type: "scatter", mode: "lines", stackgroup: "one",
    name: src,
    x: days,
    y: days.map(d => byDay.get(`${d}|${src}`) || 0),
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

function kpiCard(label, value, delta) {
  const v = (typeof value === "number") ? value.toLocaleString() : value;
  return `<div class="kpi">
    <div class="label">${label}</div>
    <div class="value">${v}</div>
    ${delta ? `<div class="delta">${delta}</div>` : ""}
  </div>`;
}
