// Channel Scorecard — one row per lead source (channel), scoring each on the
// four things we actually care about: what a lead costs, how many turn into
// qualified leads, how many convert to a mandate, and how fast we act on them.
// Pure PRESENTATION — every number reuses the cost model + stage vocabulary
// already owned by config/stages/lead_pnl, so this view derives nothing new.
// Super/admin only (surfaces the per-lead cost, which encodes the calling cost
// model), and it respects the sidebar filters via ctx.view.leads.
window.VIEWS = window.VIEWS || {};
window.VIEWS["channel-scorecard"] = function (root, ctx) {
  if (!(ctx.user && (ctx.user.isSuper || ctx.user.isAdmin))) {
    root.innerHTML = `<h2>Channel Scorecard</h2>
      <div class="card" style="padding:20px;"><p class="muted">This page is restricted to super and admin users.</p></div>`;
    return;
  }

  const { escapeHtml, emptyState } = UTILS;
  const grp = n => Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const randS = v => "R " + grp(v);
  const blue = THEME.tokens.blue, green = THEME.tokens.green, yellow = THEME.tokens.yellowDeep;

  const leads = ctx.view.leads || [];
  if (!leads.length) {
    root.innerHTML = `<h2>Channel Scorecard</h2>${emptyState()}`;
    return;
  }

  // ── Per-lead cost model (identical to Lead P&L / Costings) ────────────────
  // Dialfire (auto-created deals) = fully-loaded monthly cost ÷ auto deals per
  // month, measured live over the last 3 complete months, fallback constant
  // until create dates load. Meta = flat R80. Everything else (organic /
  // referral / manual Seller-Lead-Bank) carries no direct media cost → null.
  const dfByMonth = {}; const dfSeen = new Set();
  for (const l of leads) {
    if (l.deal_creation !== "auto" || !l.deal_created_d) continue;
    const id = l.deal_id || l.email; if (dfSeen.has(id)) continue; dfSeen.add(id);
    const k = l.deal_created_d.getFullYear() * 12 + l.deal_created_d.getMonth();
    dfByMonth[k] = (dfByMonth[k] || 0) + 1;
  }
  const curK = new Date().getFullYear() * 12 + new Date().getMonth();
  const last3 = Object.keys(dfByMonth).map(Number).filter(k => k < curK).sort((a, b) => b - a).slice(0, 3);
  const dfLive = last3.length ? Math.round(last3.reduce((a, k) => a + dfByMonth[k], 0) / last3.length) : 0;
  const dfPerMonth = dfLive || STAGES.DIALFIRE_LEADS_PER_MONTH_FALLBACK;
  const dfCost = dfPerMonth ? Math.round(STAGES.DIALFIRE_MONTHLY_COST / dfPerMonth) : null;
  const metaCost = STAGES.META_COST_PER_LEAD;

  // Cost per lead + the channel a lead belongs to. "Dialfire (auto)" is a
  // creation-mode channel (deal_creation === 'auto'), not a Source string, so it
  // takes priority; otherwise the lead's own Source is the channel (Meta,
  // Buyers Bot, Email, …). Mirrors originFor() in lead_pnl, kept in step here.
  const costFor    = l => l.deal_creation === "auto" ? dfCost : (STAGES.isMetaSource(l.source) ? metaCost : null);
  const channelFor = l => l.deal_creation === "auto" ? "Dialfire (auto)" : (l.source || "(unknown)");

  // Median is more honest than mean for a skewed time-to-act distribution.
  const median = arr => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // ── Aggregate one row per channel ─────────────────────────────────────────
  const by = new Map();
  for (const l of leads) {
    const ch = channelFor(l);
    let a = by.get(ch);
    if (!a) { a = { channel: ch, total: 0, qualified: 0, mandate: 0, costSum: 0, costN: 0, ttfa: [] }; by.set(ch, a); }
    a.total++;
    if (STAGES.isQualified(l.current_stage)) a.qualified++;
    if (STAGES.isMandate(l.current_stage))   a.mandate++;
    const c = costFor(l);
    if (c != null) { a.costSum += c; a.costN++; }
    // Days-to-first-action PROXY: lead received (datestamp) → HubSpot deal
    // created (hs_createdate). True first-contact (first call / first note)
    // isn't synced to the browser, so this stands in for it and is labelled a
    // proxy. Only count sane, non-negative gaps where both dates exist.
    if (l.datestamp_d && l.deal_created_d) {
      const days = (l.deal_created_d - l.datestamp_d) / 86400000;
      if (days >= 0 && days < 365) a.ttfa.push(days);
    }
  }
  const rows = Array.from(by.values()).map(a => ({
    ...a,
    costPer: a.costN ? Math.round(a.costSum / a.costN) : null,
    qualPct: a.total ? a.qualified / a.total * 100 : 0,
    mandPct: a.total ? a.mandate / a.total * 100 : 0,
    ttfaMed: median(a.ttfa),
  })).sort((x, y) => y.total - x.total);

  // Blended totals across every channel for the header KPIs.
  const tTotal = rows.reduce((s, r) => s + r.total, 0);
  const tQual  = rows.reduce((s, r) => s + r.qualified, 0);
  const tMand  = rows.reduce((s, r) => s + r.mandate, 0);
  const tCostSum = rows.reduce((s, r) => s + r.costSum, 0);
  const tCostN   = rows.reduce((s, r) => s + r.costN, 0);

  const classifyPct = p => p >= 40 ? "green" : p >= 20 ? "amber" : (p > 0 ? "red" : "");
  const barCell = (p, cls) => {
    const w = Math.max(0, Math.min(100, p));
    return `<div class="bar ${cls}"><span style="width:${w}%"></span></div>
            <span class="muted small">${p.toFixed(1)}%</span>`;
  };
  const costCell = c => c == null
    ? `<span class="muted">n/a</span>`
    : `<strong>${randS(c)}</strong>`;
  const ttfaCell = d => d == null
    ? `<span class="muted">n/a</span>`
    : `${d.toFixed(1)}<span class="muted small"> d</span>`;

  function card(label, value, sub, accent) {
    return `<div class="kpi"${accent ? ` style="border-left:4px solid ${accent};"` : ""}>
      <div class="label">${label}</div><div class="value">${value}</div>
      ${sub ? `<div class="delta-row muted small">${sub}</div>` : ""}</div>`;
  }

  const rowsHtml = rows.map(r => `<tr>
    <td><strong>${escapeHtml(r.channel)}</strong></td>
    <td class="num">${grp(r.total)}</td>
    <td class="num">${costCell(r.costPer)}</td>
    <td>${barCell(r.qualPct, classifyPct(r.qualPct))}</td>
    <td>${barCell(r.mandPct, classifyPct(r.mandPct))}</td>
    <td class="num">${ttfaCell(r.ttfaMed)}</td>
  </tr>`).join("");

  root.innerHTML = `
    <h2>Channel Scorecard</h2>
    <p class="lede">Every lead source scored on the four things that matter: what a lead costs, how many qualify, how many convert to a mandate, and how fast we act. Reuses the same cost and stage model as Lead P&amp;L. Respects the sidebar filters.</p>

    <div class="kpis" style="margin-top:16px;">
      ${card("Leads", grp(tTotal), `across ${rows.length} channel${rows.length === 1 ? "" : "s"}`, blue)}
      ${card("Blended cost / lead", tCostN ? randS(tCostSum / tCostN) : "n/a", tCostN ? `on ${grp(tCostN)} costed leads` : "no costed leads", yellow)}
      ${card("Qualified", tTotal ? (tQual / tTotal * 100).toFixed(1) + "%" : "—", `${grp(tQual)} qualified`, green)}
      ${card("Mandate conversion", tTotal ? (tMand / tTotal * 100).toFixed(1) + "%" : "—", `${grp(tMand)} mandates`, green)}
    </div>

    <section class="card" style="margin-top:16px;">
      <h3>Per-channel scorecard</h3>
      <p class="section-caption">
        <strong>Cost / lead</strong>: Dialfire ${dfCost == null ? "n/a" : randS(dfCost)} each
        (${randS(STAGES.DIALFIRE_MONTHLY_COST)}/mo &divide; ${grp(dfPerMonth)} auto deals), Meta ${randS(metaCost)};
        other Seller-Lead-Bank channels carry no direct media cost (n/a).
        <strong>Qualified</strong> = warm / hot / any mandate / sold.
        <strong>Mandate</strong> = won the listing (sole or other mandate).
      </p>
      <div class="table-wrap"><table class="dt">
        <thead><tr>
          <th>Channel</th>
          <th class="num">Leads</th>
          <th class="num">Cost / lead</th>
          <th>% Qualified</th>
          <th>% Mandate</th>
          <th class="num">Days to 1st action <span title="Proxy — see note below">*</span></th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px;">
        * <strong>Days to 1st action is a proxy</strong>: median days from the lead landing (datestamp) to its HubSpot
        deal being created (hs_createdate). A true first-action timestamp (first call logged / first note) isn't synced
        to the browser yet, so read this as time-to-deal, not time-to-first-touch. Channels with no dated deals show n/a.
        Cost per lead is a blended average over the leads in each channel we can price.
      </p>
    </section>
  `;
};
