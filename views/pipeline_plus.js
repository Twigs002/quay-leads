// Pipeline+ (beta) — an interactive, comparison-first take on the Pipeline
// page. Adds an in-view toolbar (compare-against · break-down-by · headline
// metric), a calendar-aligned year-over-year trend (June sits above June),
// click-to-focus cross-filtering, a segment leaderboard with rank movement,
// and a velocity/ageing panel. It reads the same data as every other view:
// ctx.view.leads is the sidebar-filtered current period; the comparison window
// is derived from FILTERS.state (shifted a year, or the previous period);
// revenue comes from the sales_deals actuals register. Left as an extra tab so
// the existing Pipeline is untouched.
window.VIEWS = window.VIEWS || {};
(function () {
  // View-local state persists across re-renders (module scope, not on ctx which
  // the router rebuilds every pass).
  const S = { cmp: "yoy", group: "division", metric: "leads", filter: null };
  let ROOT = null, CTX = null;

  window.VIEWS["pipeline-plus"] = function (root, ctx) { ROOT = root; CTX = ctx; render(); };

  const isFB = (s) => /\b(facebook|fb)\b/i.test(s || "");
  const isIG = (s) => /\b(instagram|ig)\b/i.test(s || "");
  const GROUPS = {
    division: { label: "Division",  of: (l) => l.division || "(no division)" },
    source:   { label: "Source",    of: (l) => l.source || "(no source)" },
    platform: { label: "Platform",  of: (l) => isFB(l.source) ? "Facebook" : isIG(l.source) ? "Instagram" : null },
    leadtype: { label: "Lead type", of: (l) => l.is_lead || "(no type)" },
  };
  const METRICS = {
    leads:     { label: "Leads",       kind: "count", val: (s) => s.leads },
    deals:     { label: "Deals",       kind: "count", val: (s) => s.deals },
    workedPct: { label: "Worked %",    kind: "pct",   val: (s) => s.leads ? s.worked / s.leads * 100 : 0 },
    qualPct:   { label: "Qualified %", kind: "pct",   val: (s) => s.leads ? s.qual / s.leads * 100 : 0 },
    mandates:  { label: "Mandates",    kind: "count", val: (s) => s.mand },
    wonValue:  { label: "Won value",   kind: "money", val: (s) => s.wonVal },
  };
  const KPI_ORDER = ["leads", "deals", "workedPct", "qualPct", "mandates", "wonValue"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ── metric helpers ────────────────────────────────────────────────
  function summarize(leads) {
    const s = { leads: leads.length, deals: 0, worked: 0, qual: 0, mand: 0, sold: 0, wonVal: 0 };
    for (const l of leads) {
      if (l.has_deal) s.deals++;
      if (l.worked) s.worked++;
      if (STAGES.isQualified(l.current_stage)) s.qual++;
      if (STAGES.isMandate(l.current_stage)) s.mand++;
      if (l.current_stage === STAGES.WON) s.sold++;
      if (STAGES.isWonListing(l.current_stage)) s.wonVal += Number(l.amount) || 0;
    }
    return s;
  }
  const metricVal = (k, s) => METRICS[k].val(s);

  const fmtInt = (n) => Math.round(n).toLocaleString("en-ZA");
  const fmtPct = (n) => n.toFixed(1) + "%";
  const fmtMoney = (n) => "R" + (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + "m" : Math.round(n).toLocaleString("en-ZA"));
  const fmtMetric = (k, v) => METRICS[k].kind === "pct" ? fmtPct(v) : METRICS[k].kind === "money" ? fmtMoney(v) : fmtInt(v);

  function deltaPill(cur, prev, isPct) {
    if (prev == null || prev === 0) return '<span class="delta flat">—</span>';
    const d = (cur - prev) / Math.abs(prev) * 100;
    const cls = d > 0.5 ? "up" : d < -0.5 ? "down" : "flat";
    const car = d > 0.5 ? "▲ " : d < -0.5 ? "▼ " : "";
    const val = isPct ? ((cur - prev >= 0 ? "+" : "") + (cur - prev).toFixed(1) + "pp")
                      : ((d >= 0 ? "+" : "") + d.toFixed(0) + "%");
    return `<span class="delta ${cls}">${car}${val}</span>`;
  }

  // ── data slices (all real) ────────────────────────────────────────
  function nonDatePred() {
    const st = FILTERS.state;
    return (l) => {
      if (st.divisions.size && !st.divisions.has(l.division)) return false;
      if (st.sources.size && !st.sources.has(l.source)) return false;
      if (st.leadTypes.size && !st.leadTypes.has(l.is_lead)) return false;
      if (st.noDealOnly && l.has_deal) return false;
      if (st.leadOrigin === "dialfire" && l.deal_creation !== "auto") return false;
      if (st.leadOrigin === "slb" && l.deal_creation === "auto") return false;
      return true;
    };
  }
  function focusPred() {
    if (!S.filter) return () => true;
    const of = GROUPS[S.group].of;
    return (l) => of(l) === S.filter;
  }
  function currentLeads() { return CTX.view.leads.filter(focusPred()); }

  function comparisonWindow() {
    const st = FILTERS.state;
    if (S.cmp === "off" || !st.from || !st.to) return null;
    const from = new Date(st.from), to = new Date(st.to);
    if (S.cmp === "yoy") {
      const f = new Date(from); f.setFullYear(f.getFullYear() - 1);
      const t = new Date(to); t.setFullYear(t.getFullYear() - 1);
      return [f, t];
    }
    const len = to - from, t = new Date(from.getTime() - 1), f = new Date(t.getTime() - len);
    return [f, t];
  }
  function comparisonLeads() {
    const w = comparisonWindow(); if (!w) return null;
    const [f, t] = w, nd = nonDatePred(), fo = focusPred();
    return CTX.cache.leads.filter((l) => l.datestamp_d && l.datestamp_d >= f && l.datestamp_d <= t && nd(l) && fo(l));
  }

  // ── render ────────────────────────────────────────────────────────
  function render() {
    const { escapeHtml, emptyState } = UTILS;
    if (!CTX.view.leads.length) { ROOT.innerHTML = `<h2>Pipeline+</h2>${emptyState()}`; return; }

    const dimLabel = GROUPS[S.group].label;
    const cmpOn = S.cmp !== "off";
    const hasWindow = !!(FILTERS.state.from && FILTERS.state.to);

    ROOT.innerHTML = `
      <h2>Pipeline+ <span class="pill amber" style="vertical-align:middle;">Beta</span></h2>
      <p class="lede">The Pipeline page with controls: measure this period against the same period last year,
        break the book down by any dimension, and click a segment to focus the whole page on it.
        Sidebar filters set the current period; the trend shows a full-year overlay so June sits above June.</p>

      <div class="pp-toolbar" style="display:flex; gap:22px; flex-wrap:wrap; align-items:flex-end; margin-bottom:20px;">
        ${segControl("Compare against", "pp-cmp", [
          ["yoy", "Last year"], ["prev", "Prev period"], ["off", "Off"]], S.cmp)}
        ${segControl("Break down by", "pp-group", [
          ["division", "Division"], ["source", "Source"], ["platform", "Platform"], ["leadtype", "Lead type"]], S.group)}
        ${segControl("Headline metric", "pp-metric", [
          ["leads", "Leads"], ["deals", "Deals"], ["workedPct", "Worked&nbsp;%"],
          ["qualPct", "Qual&nbsp;%"], ["mandates", "Mandates"], ["wonValue", "Won&nbsp;value"]], S.metric)}
      </div>

      <div class="pp-focus" id="pp-focus" style="margin:-8px 0 18px;"></div>

      <div class="kpis" id="pp-kpis"></div>

      <div class="grid-2" style="margin-bottom:28px;">
        <section class="card">
          <h3 id="pp-trendh">Trend</h3>
          <p class="section-caption" id="pp-trendcap"></p>
          <div id="pp-trend" style="height:340px;"></div>
        </section>
        <section class="card">
          <h3>Conversion funnel</h3>
          <p class="section-caption">Each step as a share of leads received${cmpOn ? ", with Δ vs the comparison period" : ""}.</p>
          <div id="pp-funnel"></div>
        </section>
      </div>

      <section>
        <h3>Revenue &amp; commission</h3>
        <p class="section-caption">From the <strong>sales_deals</strong> actuals register, by close date${hasWindow ? " in the selected range" : " (whole book — set a date range to scope it)"}. Whole-book — not affected by the break-down focus.</p>
        <div class="kpis" id="pp-rev"></div>
      </section>

      <section>
        <h3 id="pp-boardh">By ${escapeHtml(dimLabel.toLowerCase())} leaderboard</h3>
        <p class="section-caption">${cmpOn ? "Rank movement vs the comparison period. " : ""}<strong>Click a row</strong> to focus every panel on that segment.</p>
        <div class="table-wrap"><table class="dt" id="pp-board"></table></div>
      </section>

      <section class="card">
        <h3>Velocity &amp; ageing</h3>
        <p class="section-caption">Open, unworked leads with no logged call, by age since the lead came in. Anything past
          <strong>72&nbsp;h</strong> is what the nightly auto-reassignment sweep moves to another team.</p>
        <div class="kpis" id="pp-vel" style="margin-bottom:14px;"></div>
        <div id="pp-age"></div>
      </section>
    `;

    renderFocus(); renderKPIs(); renderRevenue(); renderBoard(); renderVelocity(); renderTrend(); renderFunnel();
    wire();
  }

  function segControl(label, id, opts, active) {
    const btns = opts.map(([v, t]) =>
      `<button type="button" class="team-window-btn ${v === active ? "active" : ""}" data-v="${v}">${t}</button>`).join("");
    return `<div style="display:flex; flex-direction:column; gap:7px;">
      <span class="filter-sub" style="margin:0;">${label}</span>
      <div class="segmented" id="${id}" style="flex-wrap:wrap;">${btns}</div>
    </div>`;
  }

  function renderFocus() {
    const el = document.getElementById("pp-focus");
    if (!S.filter) { el.innerHTML = ""; return; }
    el.innerHTML = `<span class="pill" style="background:var(--blue-800); color:#fff; border-color:var(--blue-800); font-size:12px; padding:4px 6px 4px 12px;">
      Focused · ${UTILS.escapeHtml(S.filter)}
      <button id="pp-clear" aria-label="Clear focus" style="margin-left:6px; border:0; background:rgba(255,255,255,.25); color:#fff; width:16px; height:16px; border-radius:50%; cursor:pointer; line-height:1;">✕</button>
    </span> <span class="muted small">every panel is scoped to this ${GROUPS[S.group].label.toLowerCase()}.</span>`;
    document.getElementById("pp-clear").onclick = () => { S.filter = null; render(); };
  }

  function renderKPIs() {
    const cur = summarize(currentLeads());
    const cmp = comparisonLeads();
    const prev = cmp ? summarize(cmp) : null;
    document.getElementById("pp-kpis").innerHTML = KPI_ORDER.map((key) => {
      const M = METRICS[key], isPct = M.kind === "pct";
      const cv = metricVal(key, cur), pv = prev ? metricVal(key, prev) : null;
      const row = S.cmp === "off"
        ? '<div class="delta-row muted">no comparison</div>'
        : `<div class="delta-row">${deltaPill(cv, pv, isPct)} <span class="muted">vs ${prev ? fmtMetric(key, pv) : "—"}</span></div>`;
      const sel = S.metric === key;
      return `<div class="kpi" data-metric="${key}" tabindex="0" role="button" style="cursor:pointer;${sel ? "border-color:var(--blue-800);box-shadow:inset 0 0 0 1px var(--blue-800);" : ""}">
        <div class="label">${M.label}</div>
        <div class="value">${fmtMetric(key, cv)}</div>
        ${row}
      </div>`;
    }).join("");
  }

  function kpiCard(label, value, sub) {
    return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="delta-row">${sub}</div></div>`;
  }

  function revenueFor(win) {
    const [f, t] = win || [null, null];
    let comm = 0, n = 0, rent = 0, sale = 0;
    for (const s of (CTX.cache.salesDeals || [])) {
      if (!s.deal_date_d) continue;
      if (f && s.deal_date_d < f) continue;
      if (t && s.deal_date_d > t) continue;
      const c = (s.commission_incl_vat != null ? s.commission_incl_vat : s.quay1_gross_comm) || 0;
      comm += c; n++; if (s.is_rental) rent += c; else sale += c;
    }
    return { comm, n, rent, sale, avg: n ? comm / n : 0 };
  }
  function renderRevenue() {
    const st = FILTERS.state;
    const cur = revenueFor([st.from || null, st.to || null]);
    const cmpW = comparisonWindow();
    const prev = cmpW ? revenueFor(cmpW) : null;
    const c = (cv, pv, f) => S.cmp === "off" || !prev
      ? '<span class="muted">no comparison</span>'
      : `${deltaPill(cv, pv, false)} <span class="muted">vs ${pv != null ? f(pv) : "—"}</span>`;
    document.getElementById("pp-rev").innerHTML = [
      kpiCard("Commission won", fmtMoney(cur.comm), c(cur.comm, prev && prev.comm, fmtMoney)),
      kpiCard("Deals closed", fmtInt(cur.n), c(cur.n, prev && prev.n, fmtInt)),
      kpiCard("Avg commission / deal", fmtMoney(cur.avg), c(cur.avg, prev && prev.avg, fmtMoney)),
      kpiCard("Sale vs rental", fmtMoney(cur.sale), `<span class="muted">${fmtMoney(cur.rent)} from rentals</span>`),
    ].join("");
  }

  function barCell(p) {
    const cls = p >= 75 ? "green" : p >= 50 ? "amber" : (p > 0 ? "red" : "");
    const w = Math.max(0, Math.min(100, p));
    return `<div style="display:flex;align-items:center;gap:8px;"><div class="bar ${cls}" style="flex:1;max-width:70px;"><span style="width:${w}%"></span></div><span class="muted small">${p.toFixed(0)}%</span></div>`;
  }
  function renderBoard() {
    const { escapeHtml } = UTILS;
    const of = GROUPS[S.group].of, key = S.metric, M = METRICS[key];
    const curLeads = CTX.view.leads;                       // NB: leaderboard shows all segments (not focus-filtered)
    const groups = {};
    for (const l of curLeads) { const g = of(l); if (g == null) continue; (groups[g] = groups[g] || []).push(l); }
    const cmp = comparisonLeads();                          // already focus-filtered, but focus is per-segment here; recompute unfocused
    const cmpAll = (function () {
      const w = comparisonWindow(); if (!w) return null;
      const [f, t] = w, nd = nonDatePred();
      const out = {};
      for (const l of CTX.cache.leads) {
        if (!l.datestamp_d || l.datestamp_d < f || l.datestamp_d > t || !nd(l)) continue;
        const g = of(l); if (g == null) continue; (out[g] = out[g] || []).push(l);
      }
      return out;
    })();

    const rows = Object.entries(groups).map(([g, ls]) => ({ g, s: summarize(ls) }));
    const curRankMap = rankMap(rows, key);
    let prevRankMap = null;
    if (cmpAll) prevRankMap = rankMap(Object.entries(cmpAll).map(([g, ls]) => ({ g, s: summarize(ls) })), key);
    rows.sort((a, b) => metricVal(key, b.s) - metricVal(key, a.s));

    document.getElementById("pp-boardh").textContent = `By ${M ? GROUPS[S.group].label.toLowerCase() : ""} leaderboard`;
    const head = `<thead><tr><th>#</th><th>${escapeHtml(GROUPS[S.group].label)}</th>
      <th class="num">Leads</th><th class="num">Deals</th><th>Worked %</th>
      <th class="num">Mandates</th><th class="num">Won value</th><th class="num">${escapeHtml(M.label)}</th></tr></thead>`;
    const body = rows.map((r) => {
      const s = r.s, mv = metricVal(key, s), workedPct = s.leads ? s.worked / s.leads * 100 : 0;
      let move = '<span class="muted">—</span>';
      if (prevRankMap && prevRankMap[r.g] != null) {
        const d = prevRankMap[r.g] - curRankMap[r.g];
        move = d > 0 ? `<span style="color:var(--green);font-weight:700;">▲${d}</span>`
             : d < 0 ? `<span style="color:var(--red);font-weight:700;">▼${-d}</span>`
             : '<span class="muted">—</span>';
      }
      const sel = S.filter === r.g;
      return `<tr data-g="${escapeHtml(r.g)}" style="cursor:pointer;${sel ? "background:var(--sky-tint);" : ""}">
        <td>${curRankMap[r.g]} ${move}</td>
        <td>${sel ? "<strong>" + escapeHtml(r.g) + "</strong>" : escapeHtml(r.g)}</td>
        <td class="num">${fmtInt(s.leads)}</td>
        <td class="num">${fmtInt(s.deals)}</td>
        <td>${barCell(workedPct)}</td>
        <td class="num">${fmtInt(s.mand)}</td>
        <td class="num">${fmtMoney(s.wonVal)}</td>
        <td class="num"><strong>${fmtMetric(key, mv)}</strong></td>
      </tr>`;
    }).join("");
    const t = document.getElementById("pp-board");
    t.innerHTML = head + "<tbody>" + body + "</tbody>";
    t.querySelectorAll("tbody tr").forEach((tr) => tr.onclick = () => {
      S.filter = (S.filter === tr.dataset.g) ? null : tr.dataset.g; render();
    });
  }
  function rankMap(rows, key) {
    const s = rows.slice().sort((a, b) => metricVal(key, b.s) - metricVal(key, a.s));
    const m = {}; s.forEach((r, i) => m[r.g] = i + 1); return m;
  }

  function renderVelocity() {
    const now = new Date();
    const open = currentLeads().filter((l) => l.datestamp_d && !l.worked
      && !STAGES.isWonListing(l.current_stage) && !STAGES.isLost(l.current_stage)
      && l.current_stage !== STAGES.OUT_OF_AREA);
    const ageH = (l) => (now - l.datestamp_d) / 36e5;
    const b = [0, 0, 0, 0]; // 0-24, 24-72, 72-168, >168
    for (const l of open) { const h = ageH(l); b[h < 24 ? 0 : h < 72 ? 1 : h < 168 ? 2 : 3]++; }
    const total = open.length || 1;
    const over72 = b[2] + b[3];
    document.getElementById("pp-vel").innerHTML =
      kpiCard("Open &amp; unworked", fmtInt(open.length), '<span class="muted">in the current filter</span>') +
      `<div class="kpi"><div class="label">&gt;72&nbsp;h · no call</div><div class="value" style="color:${over72 / total > 0.34 ? "var(--red)" : "var(--yellow-deep)"};">${(over72 / total * 100).toFixed(0)}%</div><div class="delta-row muted">reassignment backlog</div></div>` +
      kpiCard("7&nbsp;days+ stale", fmtInt(b[3]), '<span class="muted">oldest, no call logged</span>');
    const labels = ["0–24 h", "24–72 h", "72 h – 7 d", "> 7 d"];
    const cols = ["var(--green)", "var(--amber)", "#DE7A1E", "var(--red)"];
    document.getElementById("pp-age").innerHTML = b.map((n, i) =>
      `<div style="display:grid;grid-template-columns:90px 1fr 52px;align-items:center;gap:12px;margin:7px 0;font-size:12.5px;">
        <span style="color:var(--slate);">${labels[i]}</span>
        <div class="bar" style="height:16px;"><span style="width:${(n / total * 100).toFixed(0)}%;background:${cols[i]};"></span></div>
        <span class="num muted" style="text-align:right;">${fmtInt(n)}</span>
      </div>`).join("");
  }

  // ── trend (Plotly, calendar YoY overlay) ──────────────────────────
  function trendLeads() {
    const nd = nonDatePred(), fo = focusPred();
    return CTX.cache.leads.filter((l) => l.datestamp_d && nd(l) && fo(l));
  }
  function renderTrend() {
    const key = S.metric, M = METRICS[key], isPct = M.kind === "pct";
    const leads = trendLeads();
    if (!leads.length) { document.getElementById("pp-trend").innerHTML = UTILS.emptyState("No leads to chart."); return; }
    const curYear = Math.max(...leads.map((l) => l.datestamp_d.getFullYear()));
    const prevYear = curYear - 1;
    const maxMonthCur = Math.max(...leads.filter((l) => l.datestamp_d.getFullYear() === curYear).map((l) => l.datestamp_d.getMonth()));
    const bucket = (yr) => { const arr = Array.from({ length: 12 }, () => []);
      for (const l of leads) if (l.datestamp_d.getFullYear() === yr) arr[l.datestamp_d.getMonth()].push(l); return arr; };
    const seriesOf = (yr, cur) => bucket(yr).map((arr, i) =>
      (cur && i > maxMonthCur) ? null : metricVal(key, summarize(arr)));
    const cur = seriesOf(curYear, true), prev = seriesOf(prevYear, false);
    const showPrev = S.cmp !== "off";

    const traces = [];
    if (showPrev) traces.push({ type: "scatter", mode: "lines+markers", name: String(prevYear),
      x: MONTHS, y: prev, connectgaps: false, line: { color: "#AEB9CE", dash: "dash", width: 2 }, marker: { color: "#AEB9CE", size: 5 } });
    traces.push({ type: "scatter", mode: "lines+markers", name: String(curYear),
      x: MONTHS, y: cur, connectgaps: false, line: { color: THEME.tokens.blue, width: 3 }, marker: { color: THEME.tokens.blue, size: 6 } });

    const layout = THEME.PLOTLY_LAYOUT;
    layout.height = 340; layout.showlegend = true;
    layout.legend = { ...layout.legend, orientation: "h", y: 1.12, x: 0 };
    layout.yaxis = { ...layout.yaxis, title: isPct ? "%" : "", rangemode: "tozero" };
    if (showPrev && cur[5] != null && prev[5] != null) {
      const d = prev[5] ? (isPct ? (cur[5] - prev[5] >= 0 ? "+" : "") + (cur[5] - prev[5]).toFixed(1) + "pp"
        : ((cur[5] - prev[5]) / Math.abs(prev[5]) * 100 >= 0 ? "+" : "") + ((cur[5] - prev[5]) / Math.abs(prev[5]) * 100).toFixed(0) + "%") : "";
      layout.annotations = [{ x: "Jun", y: Math.max(cur[5], prev[5]), text: "Jun " + d, showarrow: false,
        yshift: 16, font: { color: THEME.tokens.ink, size: 11 }, bgcolor: "rgba(253,197,3,0.18)", borderpad: 3 }];
      layout.shapes = [{ type: "line", x0: "Jun", x1: "Jun", yref: "paper", y0: 0, y1: 1,
        line: { color: THEME.tokens.yellowDeep, width: 1.4, dash: "dot" } }];
    }
    Plotly.newPlot("pp-trend", traces, layout, THEME.PLOTLY_CONFIG);
    document.getElementById("pp-trendh").textContent = `${M.label} by month — ${curYear} vs ${prevYear}`;
    document.getElementById("pp-trendcap").textContent = showPrev
      ? "Calendar-aligned across the whole book, so June sits above June (ignores the sidebar date range on purpose)."
      : `Showing ${curYear} only — turn comparison on to overlay ${prevYear}.`;
  }

  // ── funnel (share-of-leads, matches the app's funnel semantics) ───
  function renderFunnel() {
    const a = summarize(currentLeads());
    const cmp = comparisonLeads(), b = cmp ? summarize(cmp) : null;
    const steps = [
      ["Leads received", (s) => s.leads],
      ["Worked (called)", (s) => s.worked],
      ["Deal created", (s) => s.deals],
      ["Qualified stage", (s) => s.qual],
      ["Mandate won", (s) => s.mand],
      ["Sold", (s) => s.sold],
    ];
    const top = steps[0][1](a) || 1;
    document.getElementById("pp-funnel").innerHTML = steps.map(([name, f]) => {
      const v = f(a), share = v / top * 100;
      const shareB = b ? f(b) / (steps[0][1](b) || 1) * 100 : null;
      const d = b ? deltaPill(share, shareB, true) : "";
      return `<div style="display:grid;grid-template-columns:118px 1fr 52px 96px;align-items:center;gap:12px;margin:9px 0;">
        <span style="font-size:12.5px;color:var(--slate);">${name}</span>
        <div class="bar" style="height:24px;"><span style="width:${Math.max(2, share).toFixed(0)}%;background:linear-gradient(90deg,var(--blue-800),var(--sky-deep));"></span></div>
        <span style="font-size:13px;font-weight:800;text-align:right;">${fmtInt(v)}</span>
        <span class="muted small" style="text-align:right;"><strong style="color:var(--ink);">${share.toFixed(0)}%</strong> of leads ${d}</span>
      </div>`;
    }).join("");
  }

  // ── wiring ────────────────────────────────────────────────────────
  function wire() {
    document.getElementById("pp-kpis").querySelectorAll(".kpi").forEach((el) => {
      const set = () => { S.metric = el.dataset.metric; render(); };
      el.onclick = set;
      el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set(); } };
    });
    const seg = (id, apply) => document.getElementById(id).querySelectorAll("button").forEach((b) =>
      b.onclick = () => { apply(b.dataset.v); render(); });
    seg("pp-cmp", (v) => S.cmp = v);
    seg("pp-group", (v) => { S.group = v; S.filter = null; });
    seg("pp-metric", (v) => S.metric = v);
  }
})();
