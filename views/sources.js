// Sources view — channel quality + mix over time + per-source trend.
window.VIEWS = window.VIEWS || {};
window.VIEWS.sources = function (root, ctx) {
  const leads = ctx.view.leads;

  // Quality table: total / seller / owner / qualified / quality%
  // (we don't have RawLeads here so we approximate from leads — only
  // 'real' types are present; "junk" filtering happens upstream)
  const bySrc = {};
  for (const l of leads) {
    const k = l.source || "(unknown)";
    if (!bySrc[k]) bySrc[k] = { total: 0, seller: 0, owner: 0, hasDeal: 0, worked: 0 };
    bySrc[k].total++;
    if (l.is_lead === "Seller Lead") bySrc[k].seller++;
    if (l.is_lead === "Owner")       bySrc[k].owner++;
    if (l.has_deal) bySrc[k].hasDeal++;
    if (l.worked)   bySrc[k].worked++;
  }
  const rows = Object.entries(bySrc).map(([src, s]) => ({
    src, ...s,
    dealPct: s.total ? (s.hasDeal / s.total * 100) : 0,
    workedPct: s.total ? (s.worked / s.total * 100) : 0,
  })).sort((a, b) => b.total - a.total);

  root.innerHTML = `
    <h2>Sources</h2>
    <p class="lede">Where leads come from, how they convert, and how the mix moves over time.</p>

    <section>
      <h3>Channel quality</h3>
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
          <tbody>${rows.map(r => `
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
    </section>
  `;

  // Monthly stacked bar
  const monthly = {};
  for (const l of leads) {
    if (!l.datestamp_d) continue;
    const m = `${l.datestamp_d.getFullYear()}-${String(l.datestamp_d.getMonth() + 1).padStart(2, "0")}`;
    const k = `${m}|${l.source || "(unknown)"}`;
    monthly[k] = (monthly[k] || 0) + 1;
  }
  const months = Array.from(new Set(Object.keys(monthly).map(k => k.split("|")[0]))).sort();
  const srcs = Array.from(new Set(leads.map(l => l.source || "(unknown)"))).sort();
  const traces = srcs.map(src => ({
    type: "bar", name: src,
    x: months,
    y: months.map(m => monthly[`${m}|${src}`] || 0),
  }));
  Plotly.newPlot("mix-time-chart", traces,
    { ...THEME.PLOTLY_LAYOUT, barmode: "stack", legend: { ...THEME.PLOTLY_LAYOUT.legend } },
    THEME.PLOTLY_CONFIG);

  // Per-source small multiples — top 6
  const top6 = rows.slice(0, 6).map(r => r.src);
  const weekly = {};
  for (const l of leads) {
    if (!l.datestamp_d || !top6.includes(l.source)) continue;
    const monday = new Date(l.datestamp_d);
    const day = monday.getDay();
    monday.setDate(monday.getDate() - ((day + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const w = monday.toISOString().slice(0, 10);
    const k = `${w}|${l.source}`;
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
      text: trunc(src, 24), showarrow: false,
      x: 0.5, y: 1.08, xref: `x${i + 1} domain`, yref: `y${i + 1} domain`,
      font: { size: 12, color: THEME.tokens.ink, weight: "bold" },
    })),
    margin: { l: 40, r: 16, t: 50, b: 40 },
  };
  // Cleaner axes for each facet
  for (let i = 0; i < top6.length; i++) {
    const ax = i === 0 ? "" : (i + 1);
    facetLayout[`xaxis${ax}`] = { ...THEME.PLOTLY_LAYOUT.xaxis, nticks: 4 };
    facetLayout[`yaxis${ax}`] = { ...THEME.PLOTLY_LAYOUT.yaxis };
  }
  Plotly.newPlot("per-source-chart", facetTraces, facetLayout, THEME.PLOTLY_CONFIG);
};

function classifyPct(p) { return p >= 75 ? "green" : p >= 50 ? "amber" : (p > 0 ? "red" : ""); }
function barCell(p, cls) {
  const w = Math.max(0, Math.min(100, p));
  return `<div class="bar ${cls}"><span style="width:${w}%"></span></div>
          <span class="muted small">${p.toFixed(1)}%</span>`;
}
function trunc(s, n) { return s && s.length > n ? s.slice(0, n - 1) + "…" : s; }
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
