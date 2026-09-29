// Market view — "the market, and what we caught of it".
// Every registered residential sale in our teams' suburbs (the market) next to
// the deals Quay 1 actually closed (the actuals, by acceptance date). Reads as a
// resource map. Data: window.MARKET_DATA (market_data.js + market_suburbs.js).
//
// This view is self-contained: it ignores the seller-lead ctx (its own dataset)
// and injects a scoped stylesheet once. Light theme only, Quay tokens.
(function () {
  const D = () => window.MARKET_DATA;

  const R = v => {
    v = Math.round(v);
    if (v >= 1e9) return "R" + (v / 1e9).toFixed(2) + "bn";
    if (v >= 1e6) return "R" + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "m";
    if (v >= 1e3) return "R" + (v / 1e3).toFixed(0) + "k";
    return "R" + v;
  };
  const N = v => Math.round(v).toLocaleString("en-ZA");

  function ensureStyle() {
    if (document.getElementById("mkt-style")) return;
    const s = document.createElement("style");
    s.id = "mkt-style";
    s.textContent = `
.mkt{--mk:var(--sky);--qy:var(--blue-800);--up:var(--green);--down:var(--red)}
.mkt .mkt-intro{margin-bottom:18px}
.mkt .eyebrow{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.mkt h1{font-size:23px;font-weight:800;letter-spacing:-.02em;margin:.15em 0 .3em;color:var(--ink)}
.mkt .sub{color:var(--slate);font-size:13.5px;max-width:78ch;line-height:1.55}
.mkt .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
.mkt .kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--r-kpi);padding:15px 17px;box-shadow:var(--shadow-sm)}
.mkt .kpi .lab{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.mkt .kpi .big{font-size:24px;font-weight:800;letter-spacing:-.02em;margin-top:6px;color:var(--ink)}
.mkt .kpi .meta{font-size:12.5px;color:var(--slate);margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.mkt .chip{font-size:11px;font-weight:700;padding:2px 7px;border-radius:20px}
.mkt .chip.up{color:var(--up);background:color-mix(in srgb,var(--up) 14%,transparent)}
.mkt .chip.down{color:var(--down);background:color-mix(in srgb,var(--down) 14%,transparent)}
.mkt .chip.flat{color:var(--slate);background:var(--line)}
.mkt .grid{display:grid;gap:18px}.mkt .cols{grid-template-columns:1.6fr 1fr}
@media(max-width:900px){.mkt .cols{grid-template-columns:1fr}.mkt .kpis{grid-template-columns:repeat(2,1fr)}}
.mkt .panel{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);padding:18px 19px;box-shadow:var(--shadow-sm);margin-top:18px}
.mkt .grid .panel{margin-top:0}
.mkt .phead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap}
.mkt h2{font-size:15.5px;font-weight:700;margin:0;color:var(--ink)}
.mkt .note{font-size:12px;color:var(--muted)}
.mkt .seg{display:flex;gap:2px;background:var(--line);border-radius:9px;padding:3px}
.mkt .seg button{border:0;background:transparent;color:var(--slate);font:inherit;font-size:12px;font-weight:600;padding:5px 10px;border-radius:6px;cursor:pointer}
.mkt .seg button[aria-pressed="true"]{background:var(--card);color:var(--blue-800);box-shadow:var(--shadow-sm)}
.mkt .legend{display:flex;gap:16px;font-size:12px;color:var(--slate);margin-top:10px;flex-wrap:wrap}
.mkt .legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.mkt .qwrap{display:flex;align-items:flex-end;gap:22px;height:220px;padding:26px 6px 0;position:relative}
.mkt .qcol{flex:1;display:flex;flex-direction:column;align-items:center;gap:9px;height:100%;justify-content:flex-end}
.mkt .qbars{display:flex;align-items:flex-end;gap:6px;height:100%;width:100%;justify-content:center}
.mkt .qbar{width:34px;border-radius:6px 6px 0 0;position:relative;transition:height .5s cubic-bezier(.2,.7,.2,1);min-height:2px}
.mkt .qbar .v{position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:10.5px;font-weight:700;white-space:nowrap;color:var(--slate)}
.mkt .qlab{font-size:12.5px;font-weight:600;color:var(--ink);text-align:center}
.mkt .qlab small{display:block;color:var(--muted);font-weight:500;font-size:11px}
.mkt .chart{width:100%}
.mkt .lb{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.mkt .lbrow{display:grid;grid-template-columns:20px 120px 1fr auto;align-items:center;gap:11px}
.mkt .rank{font-size:12px;color:var(--muted);text-align:right;font-weight:600}
.mkt .team{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mkt .track{height:24px;background:var(--line);border-radius:6px;overflow:hidden;position:relative}
.mkt .fill-mk{height:100%;background:color-mix(in srgb,var(--mk) 65%,transparent);position:absolute;inset:0;border-radius:6px;transition:width .5s cubic-bezier(.2,.7,.2,1)}
.mkt .fill-qy{height:100%;background:linear-gradient(90deg,var(--qy),color-mix(in srgb,var(--qy) 65%,var(--yellow)));position:absolute;inset:0;border-radius:6px;transition:width .5s cubic-bezier(.2,.7,.2,1);min-width:2px}
.mkt .val{font-size:12px;font-weight:700;text-align:right;min-width:150px}
.mkt .val small{color:var(--muted);font-weight:500}
.mkt .morebtn{margin-top:14px;border:1px solid var(--line);background:var(--card);color:var(--slate);font:inherit;font-size:12.5px;font-weight:600;padding:8px 14px;border-radius:9px;cursor:pointer;width:100%}
.mkt .morebtn:hover{color:var(--ink);border-color:var(--muted)}
.mkt .tablewrap{overflow-x:auto;margin-top:12px;border:1px solid var(--line);border-radius:12px}
.mkt table{border-collapse:collapse;width:100%;font-size:12.5px;min-width:720px;font-variant-numeric:tabular-nums}
.mkt th,.mkt td{padding:9px 12px;text-align:right;white-space:nowrap}
.mkt th:first-child,.mkt td:first-child{text-align:left;position:sticky;left:0;background:var(--card)}
.mkt thead th{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line);cursor:pointer;user-select:none;font-weight:700}
.mkt thead th:hover{color:var(--ink)} .mkt thead th.sorted{color:var(--blue-800)}
.mkt tbody tr:nth-child(even){background:var(--paper)}
.mkt tbody tr:nth-child(even) td:first-child{background:var(--paper)}
.mkt tbody td{border-bottom:1px solid var(--line)}
.mkt .cmatools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
.mkt .cmatools input{font:inherit;font-size:13px;padding:7px 11px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);min-width:220px}
.mkt .cmatools input:focus{outline:2px solid var(--blue-800);outline-offset:1px}
.mkt .cmatools .count{font-size:12px;color:var(--muted)}
.mkt .typ{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:5px;background:var(--sky-tint);color:var(--sky-deep)}
.mkt .typ.ft{background:color-mix(in srgb,var(--yellow) 22%,transparent);color:var(--yellow-deep)}
.mkt .foot{margin-top:22px;font-size:12px;color:var(--muted);line-height:1.7}
`;
    document.head.appendChild(s);
  }

  window.VIEWS = window.VIEWS || {};
  window.VIEWS.market = function (root) {
    ensureStyle();
    const d = D();
    if (!d) { root.innerHTML = '<div class="error-box">Market data not loaded.</div>'; return; }
    const { market, quay, allTeams, MKT, QT, suburbs } = d;

    const wrap = document.createElement("div");
    wrap.className = "mkt";
    wrap.innerHTML = `
      <div class="mkt-intro">
        <div class="eyebrow">Market vs Actuals</div>
        <h1>The market, and what we caught of it</h1>
        <div class="sub">Every registered residential sale in our teams' suburbs (the <b>market</b>, from CMA), next to the deals Quay 1 actually closed (the <b>actuals</b>, by acceptance date). Read it as a resource map: a big market bar next to a thin Quay bar is opportunity left on the table.</div>
      </div>
      <div class="kpis" id="mkt-kpis"></div>
      <section class="panel">
        <div class="phead"><h2>Market trajectory &middot; 2022 &rarr; 2025</h2><span class="note">CMA registered turnover (all agencies) in our farmed suburbs</span></div>
        <div id="mkt-trend" class="chart" style="height:340px"></div>
      </section>
      <section class="panel">
        <div class="phead"><h2>Top teams &middot; turnover trend</h2><span class="note">Eight biggest markets, 2022 &rarr; 2025 &middot; click a name to toggle</span></div>
        <div id="mkt-teamtrend" class="chart" style="height:360px"></div>
      </section>
      <section class="panel">
        <div class="phead"><h2>Growth vs contraction</h2><span class="note">3-year turnover CAGR, teams &gt; R400m in 2025 &middot; green = growing, red = shrinking</span></div>
        <div id="mkt-growth" class="chart" style="height:520px"></div>
      </section>
      <div class="grid cols">
        <div class="panel">
          <div class="phead">
            <h2>By quarter · market vs Quay</h2>
            <div class="seg" id="mkt-qscope" role="group" aria-label="Scope">
              <button data-s="q" aria-pressed="true">2026 quarters</button>
              <button data-s="y" aria-pressed="false">2025 vs 2026</button>
            </div>
          </div>
          <div class="legend"><span><i style="background:color-mix(in srgb,var(--sky) 65%,transparent)"></i>Market turnover (all agencies)</span><span><i style="background:var(--blue-800)"></i>Quay actual sold</span></div>
          <div class="qwrap" id="mkt-qchart"></div>
        </div>
        <div class="panel">
          <div class="phead"><h2>Company snapshot</h2></div>
          <div id="mkt-snap"></div>
        </div>
      </div>
      <section class="panel">
        <div class="phead">
          <h2>Team leaderboard · opportunity vs capture</h2>
          <div class="seg" id="mkt-lbperiod" role="group" aria-label="Period">
            <button data-p="y25" aria-pressed="true">2025</button>
            <button data-p="ytd" aria-pressed="false">2026 YTD</button>
          </div>
        </div>
        <div class="phead" style="margin:0"><span class="note">Light bar = size of the market · solid bar = Quay's actual sold value. Ranked by market size.</span></div>
        <div class="lb" id="mkt-lb"></div>
        <button class="morebtn" id="mkt-lbmore">Show all teams</button>
      </section>
      <section class="panel">
        <div class="phead"><h2>Quay actuals · every division</h2><span class="note">Click a column to sort · scroll →</span></div>
        <div class="tablewrap"><table id="mkt-divtbl"><thead></thead><tbody></tbody></table></div>
      </section>
      <section class="panel">
        <div class="phead"><h2>CMA figures · every suburb</h2><span class="note">The full market pull. Click a column to sort · scroll →</span></div>
        <div class="cmatools">
          <input type="text" id="mkt-cmasearch" placeholder="Filter by team or suburb…" autocomplete="off">
          <span class="count" id="mkt-cmacount"></span>
        </div>
        <div class="tablewrap"><table id="mkt-cmatbl"><thead></thead><tbody></tbody></table></div>
      </section>
      <div class="foot">
        <b>Market</b> = CMA registered sales &amp; transfers per suburb (all agencies), rolled up to the team that owns those suburbs. 2025 = full calendar year; Q1–Q3 2026 by sale date. Q3 2026 is <b>partial</b> (still registering) and excluded from run-rate.
        <b>Quay actuals</b> = Quay 1's <b>sold (paid-out) deals</b> by acceptance date, property value in ZAR. Includes rentals &amp; commercial divisions (no market comparison for those). Recent 2026 quarters understate slightly while deals are still registering / paying out. Suburbs unmatched in CMA are omitted from market totals.
      </div>`;
    root.innerHTML = "";
    root.appendChild(wrap);

    // ── KPIs ─────────────────────────────────────────────
    const qYtdV = QT.q1[1] + QT.q2[1] + QT.q3[1], qYtdN = QT.q1[0] + QT.q2[0] + QT.q3[0];
    const qRate = (QT.q1[1] + QT.q2[1]) / 2 * 4;
    const pill = (cur, prev) => {
      if (!prev) return '<span class="chip flat">—</span>';
      const dd = (cur - prev) / prev * 100;
      const c = dd > 0.5 ? "up" : dd < -0.5 ? "down" : "flat";
      const s = dd > 0 ? "▲" : dd < 0 ? "▼" : "■";
      return '<span class="chip ' + c + '">' + s + ' ' + Math.abs(dd).toFixed(0) + '%</span>';
    };
    const kpiData = [
      { lab: "Quay sold · 2025", big: R(QT.y25[1]), meta: QT.y25[0] + " deals · " + R(QT.y25c) + " comm" },
      { lab: "Quay sold · 2026 YTD", big: R(qYtdV), meta: qYtdN + " deals", extra: pill(qRate, QT.y25[1]) + " run-rate" },
      { lab: "Market · 2025", big: R(MKT.y25t), meta: N(MKT.y25s) + " sales, all agencies" },
      { lab: "Quay's share of market", big: (QT.y25[1] / MKT.y25t * 100).toFixed(2) + "%", meta: "of 2025 turnover in our suburbs" },
    ];
    wrap.querySelector("#mkt-kpis").innerHTML = kpiData.map(k =>
      '<div class="kpi"><div class="lab">' + k.lab + '</div><div class="big">' + k.big + '</div><div class="meta">' + k.meta + (k.extra ? ' ' + k.extra : '') + '</div></div>').join("");

    // ── Market trajectory (2022-2025) Plotly charts ─────────
    (function trajectory(){
      const MY = window.MARKET_YEARS;
      const host1 = wrap.querySelector("#mkt-trend");
      if (!MY || !window.Plotly) { if(host1) host1.innerHTML = '<div class="note" style="padding:20px">Multi-year chart data not loaded.</div>'; return; }
      const yr = MY.years.map(String);
      const bn = v => +(v/1e9).toFixed(3);
      const T = THEME.tokens;
      // 1) Company turnover (area) + sales volume (secondary axis)
      const l1 = THEME.PLOTLY_LAYOUT;
      l1.margin = {l:54,r:54,t:14,b:34};
      l1.xaxis.type = "category";
      l1.yaxis.title = {text:"Turnover (Rbn)", font:{size:11,color:T.muted}};
      l1.yaxis2 = {overlaying:"y", side:"right", showgrid:false, rangemode:"tozero",
        tickfont:{color:T.muted}, title:{text:"Sales (units)", font:{size:11,color:T.muted}}};
      l1.legend = {orientation:"h", y:1.14, x:0, font:{color:T.slate}};
      Plotly.newPlot(host1, [
        {x:yr, y:MY.company.turnover.map(bn), type:"scatter", mode:"lines+markers",
         name:"Market turnover (Rbn)", line:{color:T.blue,width:3,shape:"spline"},
         fill:"tozeroy", fillcolor:"rgba(152,197,237,0.22)", marker:{size:9}},
        {x:yr, y:MY.company.salesByYear, type:"scatter", mode:"lines+markers", yaxis:"y2",
         name:"Sales volume", line:{color:T.yellowDeep,width:2,dash:"dot"}, marker:{size:6}},
      ], l1, THEME.PLOTLY_CONFIG);
      // 2) Top-8 team turnover trend lines
      const top = MY.teams.slice().sort((a,b)=>b.t[3]-a.t[3]).slice(0,8);
      const l2 = THEME.PLOTLY_LAYOUT;
      l2.margin = {l:52,r:16,t:14,b:56};
      l2.xaxis.type = "category";
      l2.yaxis.title = {text:"Turnover (Rbn)", font:{size:11,color:T.muted}};
      l2.legend = {orientation:"h", y:-0.16, font:{size:10,color:T.slate}};
      Plotly.newPlot(wrap.querySelector("#mkt-teamtrend"),
        top.map(t=>({x:yr, y:t.t.map(bn), type:"scatter", mode:"lines+markers",
          name:t.team, line:{width:2.4,shape:"spline"}, marker:{size:5}})),
        l2, THEME.PLOTLY_CONFIG);
      // 3) Growth vs contraction — horizontal CAGR bars
      const elig = MY.teams.filter(t=>t.t[3]>400e6 && !t.anomaly && t.cagr!=null);
      const sorted = elig.slice().sort((a,b)=>b.cagr-a.cagr);
      const pick = sorted.slice(0,11).concat(sorted.slice(-9));
      pick.sort((a,b)=>a.cagr-b.cagr);
      const l3 = THEME.PLOTLY_LAYOUT;
      l3.margin = {l:100,r:28,t:8,b:34};
      l3.xaxis.title = {text:"3-year turnover CAGR", font:{size:11,color:T.muted}};
      l3.xaxis.tickformat = ".0%";
      Plotly.newPlot(wrap.querySelector("#mkt-growth"), [{
        type:"bar", orientation:"h",
        x:pick.map(t=>+(t.cagr).toFixed(4)), y:pick.map(t=>t.team),
        marker:{color:pick.map(t=>t.cagr>=0?T.green:T.red)},
        hovertemplate:"%{y}: %{x:.1%}/yr<extra></extra>"
      }], l3, THEME.PLOTLY_CONFIG);
    })();

    // ── Company snapshot (replaces the old "read of the room" panel) ──
    const topMarkets = Object.keys(market).map(t => ({ t, mk: market[t].t })).sort((a, b) => b.mk - a.mk).slice(0, 3);
    const gap = (qRate / QT.y25[1] - 1) * 100;
    wrap.querySelector("#mkt-snap").innerHTML =
      '<div style="display:flex;flex-direction:column;gap:12px;margin-top:8px;font-size:13px;color:var(--slate);line-height:1.5">' +
      '<div>Market turnover in our suburbs, 2025: <b style="color:var(--ink)">' + R(MKT.y25t) + '</b> across <b style="color:var(--ink)">' + N(MKT.y25s) + '</b> sales.</div>' +
      '<div>2026 pace is running <b style="color:var(--ink)">' + Math.abs(gap).toFixed(0) + '% ' + (gap >= 0 ? "ahead of" : "behind") + '</b> 2025 by value (Q1–Q2 annualised).</div>' +
      '<div>Largest markets by turnover: <b style="color:var(--ink)">' + topMarkets.map(m => m.t).join(", ") + '</b>.</div>' +
      '<div>Quay YTD commission booked: <b style="color:var(--ink)">' + R(QT.q1c + QT.q2c + QT.q3c) + '</b>.</div>' +
      '</div>';

    // ── Quarterly chart ─────────────────────────────────
    let qscope = "q";
    const qchartEl = wrap.querySelector("#mkt-qchart");
    function qchart() {
      qchartEl.innerHTML = "";
      let cols;
      if (qscope === "q") cols = [["Q1", MKT.q1t, QT.q1[1], false], ["Q2", MKT.q2t, QT.q2[1], false], ["Q3", MKT.q3t, QT.q3[1], true]];
      else { const qytd = QT.q1[1] + QT.q2[1] + QT.q3[1]; cols = [["2025", MKT.y25t, QT.y25[1], false], ["2026 YTD", MKT.q1t + MKT.q2t + MKT.q3t, qytd, true]]; }
      const max = Math.max(...cols.map(c => c[1])) * 1.16;
      cols.forEach(([lab, mv, qv, partial]) => {
        const col = document.createElement("div"); col.className = "qcol";
        const bars = document.createElement("div"); bars.className = "qbars";
        const b1 = document.createElement("div"); b1.className = "qbar";
        b1.style.height = (mv / max * 100) + "%";
        b1.style.background = "color-mix(in srgb,var(--sky) 65%,transparent)";
        b1.innerHTML = '<span class="v">' + R(mv) + '</span>';
        const b2 = document.createElement("div"); b2.className = "qbar";
        b2.style.height = Math.max(qv / max * 100, .4) + "%";
        b2.style.background = "linear-gradient(180deg,var(--blue-800),var(--blue-900))";
        b2.innerHTML = '<span class="v" style="color:var(--blue-800)">' + R(qv) + '</span>';
        bars.appendChild(b1); bars.appendChild(b2); col.appendChild(bars);
        col.innerHTML += ""; // noop
        const l = document.createElement("div"); l.className = "qlab";
        l.innerHTML = lab + "<small>" + (partial ? "partial" : "&nbsp;") + "</small>";
        col.appendChild(l);
        qchartEl.appendChild(col);
      });
      const note = document.createElement("div");
      note.style.cssText = "position:absolute;right:8px;top:4px;font-size:11px;color:var(--muted);max-width:200px;text-align:right";
      note.textContent = "Quay bars are tiny by design — the whole market vs one agency.";
      qchartEl.appendChild(note);
    }
    wrap.querySelectorAll("#mkt-qscope button").forEach(b => b.onclick = () => {
      qscope = b.dataset.s;
      wrap.querySelectorAll("#mkt-qscope button").forEach(x => x.setAttribute("aria-pressed", x === b));
      qchart();
    });
    qchart();

    // ── Leaderboard ─────────────────────────────────────
    let lbP = "y25", lbExpand = false;
    const lbEl = wrap.querySelector("#mkt-lb");
    function leaderboard() {
      const rows = Object.keys(market).map(t => {
        const mk = lbP === "y25" ? market[t].t : market[t].ytdT;
        const q = quay[t] || {};
        const qv = lbP === "y25" ? (q.y25v || 0) : (q.ytdv || 0);
        const qn = lbP === "y25" ? (q.y25n || 0) : (q.ytdn || 0);
        return { t, mk, qv, qn };
      }).sort((a, b) => b.mk - a.mk);
      const max = rows[0].mk || 1;
      const show = lbExpand ? rows : rows.slice(0, 22);
      lbEl.innerHTML = "";
      show.forEach((r, i) => {
        const row = document.createElement("div"); row.className = "lbrow";
        const capTxt = r.qv ? R(r.qv) + ' <small>· ' + r.qn + ' deal' + (r.qn !== 1 ? 's' : '') + '</small>' : '<small style="color:var(--red)">no Quay deals</small>';
        row.innerHTML = '<div class="rank">' + (i + 1) + '</div><div class="team">' + r.t + '</div>' +
          '<div class="track"><div class="fill-mk" style="width:' + (r.mk / max * 100) + '%"></div><div class="fill-qy" style="width:' + Math.min(100, Math.max(r.qv ? 1.2 : 0, r.qv / max * 100 * 8)) + '%"></div></div>' +
          '<div class="val">' + capTxt + '</div>';
        lbEl.appendChild(row);
      });
    }
    wrap.querySelectorAll("#mkt-lbperiod button").forEach(b => b.onclick = () => {
      lbP = b.dataset.p;
      wrap.querySelectorAll("#mkt-lbperiod button").forEach(x => x.setAttribute("aria-pressed", x === b));
      leaderboard();
    });
    const lbMore = wrap.querySelector("#mkt-lbmore");
    lbMore.onclick = function () { lbExpand = !lbExpand; this.textContent = lbExpand ? "Show top 22 only" : "Show all teams"; leaderboard(); };
    leaderboard();

    // ── Division table ──────────────────────────────────
    let dSort = "y25v", dDir = -1;
    const DCOLS = [["t", "Division", 0], ["y25n", "2025 deals", 1], ["y25v", "2025 value", 1], ["q1v", "Q1", 1], ["q2v", "Q2", 1], ["q3v", "Q3*", 1], ["ytdv", "2026 YTD", 1], ["mktT", "Market 2025", 1], ["cap", "Capture", 1]];
    const dThead = wrap.querySelector("#mkt-divtbl thead"), dTb = wrap.querySelector("#mkt-divtbl tbody");
    function divTable() {
      const rows = allTeams.map(t => {
        const q = quay[t] || {}, m = market[t];
        return { t, y25n: q.y25n || 0, y25v: q.y25v || 0, q1v: q.q1v || 0, q2v: q.q2v || 0, q3v: q.q3v || 0, ytdv: q.ytdv || 0, mktT: m ? m.t : 0, cap: m && m.t ? (q.y25v || 0) / m.t * 100 : null };
      });
      dThead.innerHTML = "<tr>" + DCOLS.map(c => '<th data-k="' + c[0] + '" class="' + (dSort === c[0] ? "sorted" : "") + '">' + c[1] + (dSort === c[0] ? (dDir < 0 ? " ↓" : " ↑") : "") + '</th>').join("") + "</tr>";
      dThead.querySelectorAll("th").forEach(th => th.onclick = () => { const k = th.dataset.k; if (dSort === k) dDir *= -1; else { dSort = k; dDir = k === "t" ? 1 : -1; } divTable(); });
      rows.sort((a, b) => { let av = a[dSort], bv = b[dSort]; if (av == null) av = -1; if (bv == null) bv = -1; return (av > bv ? 1 : av < bv ? -1 : 0) * dDir; });
      dTb.innerHTML = rows.map(r => "<tr><td>" + r.t + "</td><td>" + (r.y25n || "·") + "</td><td>" + (r.y25v ? R(r.y25v) : "·") + "</td><td>" + (r.q1v ? R(r.q1v) : "·") + "</td><td>" + (r.q2v ? R(r.q2v) : "·") + "</td><td>" + (r.q3v ? R(r.q3v) : "·") + "</td><td>" + (r.ytdv ? R(r.ytdv) : "·") + "</td><td>" + (r.mktT ? R(r.mktT) : "—") + "</td><td>" + (r.cap != null ? r.cap.toFixed(2) + "%" : "—") + "</td></tr>").join("");
    }
    divTable();

    // ── Per-suburb CMA table (the COO's full pull) ──────
    let cSort = "y25t", cDir = -1, cQuery = "";
    const CCOLS = [["team", "Team", 0], ["area", "Suburb", 0], ["type", "Type", 0], ["units", "Stock", 1], ["y25s", "2025 sales", 1], ["y25t", "2025 turnover", 1], ["q1t", "Q1 2026", 1], ["q2t", "Q2 2026", 1], ["q3t", "Q3 2026*", 1], ["ytdt", "2026 YTD", 1]];
    const cThead = wrap.querySelector("#mkt-cmatbl thead"), cTb = wrap.querySelector("#mkt-cmatbl tbody");
    const cCount = wrap.querySelector("#mkt-cmacount");
    function cmaTable() {
      let rows = suburbs.slice();
      if (cQuery) {
        const q = cQuery.toLowerCase();
        rows = rows.filter(r => r.team.toLowerCase().includes(q) || r.area.toLowerCase().includes(q));
      }
      cThead.innerHTML = "<tr>" + CCOLS.map(c => '<th data-k="' + c[0] + '" class="' + (cSort === c[0] ? "sorted" : "") + '">' + c[1] + (cSort === c[0] ? (cDir < 0 ? " ↓" : " ↑") : "") + '</th>').join("") + "</tr>";
      cThead.querySelectorAll("th").forEach(th => th.onclick = () => { const k = th.dataset.k; if (cSort === k) cDir *= -1; else { cSort = k; cDir = (k === "team" || k === "area" || k === "type") ? 1 : -1; } cmaTable(); });
      rows.sort((a, b) => {
        let av = a[cSort], bv = b[cSort];
        if (typeof av === "string") return av.localeCompare(bv) * cDir;
        return (av > bv ? 1 : av < bv ? -1 : 0) * cDir;
      });
      cCount.textContent = rows.length + " of " + suburbs.length + " suburbs";
      cTb.innerHTML = rows.map(r =>
        "<tr><td>" + r.team + "</td><td>" + r.area + "</td>" +
        '<td style="text-align:left"><span class="typ ' + (r.type === "FT" ? "ft" : "") + '">' + r.type + "</span></td>" +
        "<td>" + (r.units ? N(r.units) : "·") + "</td>" +
        "<td>" + (r.y25s || "·") + "</td><td>" + (r.y25t ? R(r.y25t) : "·") + "</td>" +
        "<td>" + (r.q1t ? R(r.q1t) : "·") + "</td><td>" + (r.q2t ? R(r.q2t) : "·") + "</td><td>" + (r.q3t ? R(r.q3t) : "·") + "</td>" +
        "<td>" + (r.ytdt ? R(r.ytdt) : "·") + "</td></tr>").join("");
    }
    const cSearch = wrap.querySelector("#mkt-cmasearch");
    cSearch.addEventListener("input", () => { cQuery = cSearch.value.trim(); cmaTable(); });
    cmaTable();
  };
})();
