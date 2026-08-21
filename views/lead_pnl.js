// Lead P&L - the lead-by-lead journey. For each lead: where it came from
// (Dialfire / Meta / Seller Lead Bank), what it cost us, where it sits in
// HubSpot, whether it sold (matched in the commission register) and the total
// agency commission it generated. Search any lead to trace one deal end to end.
// Super/admin only.
window.VIEWS = window.VIEWS || {};
window.VIEWS["lead-pnl"] = function (root, ctx) {
  if (!(ctx.user && (ctx.user.isSuper || ctx.user.isAdmin))) {
    root.innerHTML = `<h2>Lead P&amp;L</h2>
      <div class="card" style="padding:20px;"><p class="muted">This page is restricted to super and admin users.</p></div>`;
    return;
  }

  const { escapeHtml, escapeAttr } = UTILS;
  const grp = n => Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const randS = v => "R " + grp(v);
  const green = THEME.tokens.green, blue = THEME.tokens.blue, yellow = THEME.tokens.yellowDeep, red = "#B91C1C";

  const leads = (ctx.cache && ctx.cache.leads) || [];
  const sales = (ctx.cache && ctx.cache.salesDeals) || [];

  // ── Cost per lead by channel ──────────────────────────────────────────────
  // Dialfire = fully-loaded cost (salaries + telephony) / auto deals per month,
  // measured live over the last 3 complete months (mirrors Costings), fallback
  // constant until create dates load. Meta = flat R80. Other SLB leads (organic,
  // referral, manual) have no direct media cost, shown as n/a.
  const dfByMonth = {}; const dfSeen = new Set();
  for (const l of leads) {
    if (l.deal_creation !== "auto" || !l.deal_created_d) continue;
    const id = l.deal_id || l.email; if (dfSeen.has(id)) continue; dfSeen.add(id);
    const k = l.deal_created_d.getFullYear() * 12 + l.deal_created_d.getMonth();
    dfByMonth[k] = (dfByMonth[k] || 0) + 1;
  }
  const _now = new Date();
  const curK = _now.getFullYear() * 12 + _now.getMonth();
  const last3 = Object.keys(dfByMonth).map(Number).filter(k => k < curK).sort((a, b) => b - a).slice(0, 3);
  const dfLive = last3.length ? Math.round(last3.reduce((a, k) => a + dfByMonth[k], 0) / last3.length) : 0;
  const dfPerMonth = dfLive || STAGES.DIALFIRE_LEADS_PER_MONTH_FALLBACK;
  const dfCost = dfPerMonth ? Math.round(STAGES.DIALFIRE_MONTHLY_COST / dfPerMonth) : null;
  const metaCost = STAGES.META_COST_PER_LEAD;

  const originFor = l => STAGES.originOf(l);
  const costFor = l => { const o = originFor(l); return o === "Dialfire" ? dfCost : (o === "Meta" ? metaCost : null); };

  // ── Sale lookup: matched_deal_id → best register row (prefer paid) ─────────
  const saleBy = new Map();
  for (const s of sales) {
    if (!s.matched_deal_id) continue;
    const k = String(s.matched_deal_id);
    const prev = saleBy.get(k);
    if (!prev || (s.deal_status === "PAID_OUT" && prev.deal_status !== "PAID_OUT")) saleBy.set(k, s);
  }

  // ── One journey row per lead ──────────────────────────────────────────────
  const FELL = /(FALLEN_THROUGH|DUPLICATE)/;
  const rows = leads.map(l => {
    const sale = l.deal_id ? saleBy.get(String(l.deal_id)) : null;
    const status = sale ? sale.deal_status : null;
    const sold = status === "PAID_OUT";
    const comm = sold ? (Number(sale.total_gross_comm) || 0) : 0;
    const cost = costFor(l);
    let result;
    if (sold) result = "Sold";
    else if (status && FELL.test(status)) result = "Fell through";
    else if (status) result = "In progress";
    else if (l.has_deal) result = "In pipeline";
    else result = "No deal";
    return {
      name: l.client_name || l.deal_name || l.property_address || l.email || "(unknown)",
      origin: originFor(l),
      cost, stage: l.current_stage || (l.has_deal ? "n/a" : "No deal"),
      result, comm, net: comm - (cost || 0), sold,
      dealId: l.deal_id || "",
      _s: `${l.client_name || ""} ${l.property_address || ""} ${l.deal_name || ""} ${l.email || ""}`.toLowerCase(),
    };
  });

  const soldRows = rows.filter(r => r.sold);
  const trackedComm = soldRows.reduce((a, r) => a + r.comm, 0);
  const byOrigin = { Dialfire: { n: 0, comm: 0 }, Meta: { n: 0, comm: 0 }, "Seller Lead Bank": { n: 0, comm: 0 } };
  for (const r of soldRows) { const b = byOrigin[r.origin]; if (b) { b.n++; b.comm += r.comm; } }

  function card(label, value, sub, accent) {
    return `<div class="kpi"${accent ? ` style="border-left:4px solid ${accent};"` : ""}>
      <div class="label">${label}</div><div class="value">${value}</div>
      ${sub ? `<div class="delta-row muted small">${sub}</div>` : ""}</div>`;
  }

  const originPill = o => {
    const c = o === "Dialfire" ? blue : (o === "Meta" ? yellow : "#64748B");
    return `<span class="pill" style="background:${c}22;color:${c};">${escapeHtml(o)}</span>`;
  };
  const resultCell = r => {
    const c = r.result === "Sold" ? green : (r.result === "Fell through" ? red : (r.result === "In progress" ? yellow : "#64748B"));
    return `<span style="color:${c}; font-weight:600;">${escapeHtml(r.result)}</span>`;
  };
  const rowHtml = r => `<tr>
    <td><strong>${escapeHtml(r.name)}</strong></td>
    <td>${originPill(r.origin)}</td>
    <td class="num">${r.cost == null ? '<span class="muted">n/a</span>' : randS(r.cost)}</td>
    <td>${escapeHtml(r.stage)}</td>
    <td>${resultCell(r)}</td>
    <td class="num">${r.sold ? `<span style="color:${green};font-weight:700;">${randS(r.comm)}</span>` : '<span class="muted">n/a</span>'}</td>
    <td class="num" style="color:${r.net < 0 ? red : (r.net > 0 ? green : "inherit")};">${r.net === 0 && !r.sold && r.cost == null ? '<span class="muted">n/a</span>' : randS(r.net)}</td>
  </tr>`;

  const MAX = 400;
  const bodyHtml = list => list.length
    ? list.slice(0, MAX).map(rowHtml).join("") + (list.length > MAX
        ? `<tr><td colspan="7" class="muted" style="padding:12px;">Showing first ${MAX} of ${grp(list.length)}. Refine your search to narrow.</td></tr>`
        : "")
    : `<tr><td colspan="7" class="muted" style="padding:18px;">No matching leads.</td></tr>`;

  const defaultList = soldRows.slice().sort((a, b) => b.comm - a.comm);

  root.innerHTML = `
    <h2>Lead P&amp;L</h2>
    <p class="lede">Every lead's journey: what it cost, where it sits in HubSpot, whether it sold, and what we banked.</p>

    <section class="card" style="margin-top:16px;">
      <h3>Tracked to a sale</h3>
      <p class="section-caption">
        Leads that we can trace all the way to a paid sale (matched in the register). Dialfire leads are costed at
        <strong>${dfCost == null ? "n/a" : randS(dfCost)}</strong> each (${randS(STAGES.DIALFIRE_MONTHLY_COST)}/mo &divide; ${grp(dfPerMonth)} deals),
        Meta at <strong>${randS(metaCost)}</strong>; other Seller-Lead-Bank leads carry no direct media cost.
      </p>
      <div class="kpis" style="margin-top:4px;">
        ${card("Leads that sold", grp(soldRows.length), "traced lead → paid sale", green)}
        ${card("Commission from them", randS(trackedComm), "total agency commission", green)}
        ${card("Dialfire", randS(byOrigin.Dialfire.comm), `${grp(byOrigin.Dialfire.n)} sold`, blue)}
        ${card("Meta + Seller Lead Bank", randS(byOrigin.Meta.comm + byOrigin["Seller Lead Bank"].comm), `${grp(byOrigin.Meta.n + byOrigin["Seller Lead Bank"].n)} sold`, blue)}
      </div>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>Track a lead</h3>
      <p class="section-caption">Search by client name, address, deal name or email to trace one lead end to end. Empty search shows the leads that sold, top commission first.</p>
      <input type="text" id="lpnl-search" class="range-input" placeholder="Search a lead (name / address / email)…" style="max-width:420px; margin-bottom:12px;" autocomplete="off">
      <div class="table-wrap"><table class="dt">
        <thead><tr>
          <th>Lead</th><th>Source</th><th class="num">Lead cost</th><th>HubSpot stage</th>
          <th>Result</th><th class="num">Commission</th><th class="num">Net</th>
        </tr></thead>
        <tbody id="lpnl-body">${bodyHtml(defaultList)}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px;">
        "Net" = commission banked minus lead cost. A lead only shows as <em>Sold</em> when its HubSpot deal is matched
        to a paid deal in the register, so this is a floor: unmatched sales (seller not identifiable in our lead data)
        aren't counted here.
      </p>
    </section>
  `;

  // Search: filter all leads on the fly, rebuild the tbody.
  const $in = document.getElementById("lpnl-search");
  const $body = document.getElementById("lpnl-body");
  if ($in && $body) {
    $in.addEventListener("input", () => {
      const q = $in.value.toLowerCase().trim();
      if (!q) { $body.innerHTML = bodyHtml(defaultList); return; }
      const hits = rows.filter(r => r._s.includes(q))
        .sort((a, b) => (b.sold - a.sold) || (b.comm - a.comm));
      $body.innerHTML = bodyHtml(hits);
    });
  }
};
