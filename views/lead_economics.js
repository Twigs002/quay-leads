// Lead economics — the money view of the lead book, merged from the former
// Attribution and Lead P&L tabs. Three sections: (1) Tracked to a sale — what
// each channel cost and the commission we can trace to a paid sale; (2) How
// each sale was matched - the per-deal attribution detail. (Lead-level search
// lives on the dedicated Track tab.) Reads the whole commission register (ctx.cache
// .salesDeals) + leads, scoped only by the sidebar DATE RANGE (leads by
// datestamp_d, register rows by deal_date_d); the origin / division / source
// sidebar filters are deliberately ignored. Super/admin only.
window.VIEWS = window.VIEWS || {};
window.VIEWS["lead-economics"] = function (root, ctx) {
  if (!(ctx.user && (ctx.user.isSuper || ctx.user.isAdmin))) {
    root.innerHTML = `<h2>Lead economics</h2>
      <div class="card" style="padding:20px;"><p class="muted">This page is restricted to super and admin users.</p></div>`;
    return;
  }

  const { escapeHtml, hsDealLink } = UTILS;
  const grp = (n) => Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const randS = (v) => "R " + grp(v);
  const num = (v) => (v == null || v === "") ? 0 : (Number(v) || 0);
  const green = THEME.tokens.green, blue = THEME.tokens.blue, yellow = THEME.tokens.yellowDeep, red = "#B91C1C";

  const allLeads = (ctx.cache && ctx.cache.leads) || [];
  const allSales = (ctx.cache && ctx.cache.salesDeals) || [];

  if (!allSales.length) {
    root.innerHTML = `
      <h2>Lead economics</h2>
      <p class="lede">What each lead channel cost, the commission we can trace back to it, and how every sale was attributed.</p>
      <section class="card" style="margin-top:16px; padding:20px;">
        <h3>Waiting for the register</h3>
        <p class="muted">No sales-register rows loaded yet. This populates once the register migration is applied and the
        register sheet is shared with the sync service account. It refreshes on the 30-minute sync.</p>
      </section>`;
    return;
  }

  // Sidebar DATE RANGE is the only sidebar filter this view honours: leads by
  // their arrival (datestamp_d), register rows by their deal date (deal_date_d).
  // Both null (All) means no date filtering. Origin / division / source are left
  // alone on purpose - this is a whole-book money view scoped only by time.
  const _fs = (window.FILTERS && FILTERS.state) || {};
  const _from = _fs.from || null, _to = _fs.to || null;
  const _inRange = (d) => d && (!_from || d >= _from) && (!_to || d <= _to);
  const leads = (_from || _to) ? allLeads.filter((l) => _inRange(l.datestamp_d)) : allLeads;
  // Exclude DUPLICATE register rows everywhere in this view - they are not real
  // sales and must not inflate any count, match, or commission total.
  const sales = allSales.filter((d) =>
    (d.deal_status || "") !== "DUPLICATE" && (!(_from || _to) || _inRange(d.deal_date_d)));

  function card(label, value, sub, accent) {
    return `<div class="kpi"${accent ? ` style="border-left:4px solid ${accent};"` : ""}>
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${sub ? `<div class="delta-row muted small">${sub}</div>` : ""}
    </div>`;
  }

  // ── Cost per lead by channel (Dialfire live over the last 3 complete months,
  //    Meta flat, other SLB leads no direct media cost) ──────────────────────
  const dfByMonth = {}; const dfSeen = new Set();
  for (const l of leads) {
    if (l.deal_creation !== "auto" || !l.deal_created_d) continue;
    const id = l.deal_id || l.email; if (dfSeen.has(id)) continue; dfSeen.add(id);
    const k = l.deal_created_d.getFullYear() * 12 + l.deal_created_d.getMonth();
    dfByMonth[k] = (dfByMonth[k] || 0) + 1;
  }
  const _now = new Date();
  const curK = _now.getFullYear() * 12 + _now.getMonth();
  const last3 = Object.keys(dfByMonth).map(Number).filter((k) => k < curK).sort((a, b) => b - a).slice(0, 3);
  const dfLive = last3.length ? Math.round(last3.reduce((a, k) => a + dfByMonth[k], 0) / last3.length) : 0;
  const dfPerMonth = dfLive || STAGES.DIALFIRE_LEADS_PER_MONTH_FALLBACK;
  const dfCost = dfPerMonth ? Math.round(STAGES.DIALFIRE_MONTHLY_COST / dfPerMonth) : null;
  const metaCost = STAGES.META_COST_PER_LEAD;
  const costFor = (l) => l.deal_creation === "auto" ? dfCost : (STAGES.isMetaSource(l.source) ? metaCost : null);
  const originFor = (l) => l.deal_creation === "auto" ? "Dialfire" : (STAGES.isMetaSource(l.source) ? "Meta" : "Seller Lead Bank");

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
  const rows = leads.map((l) => {
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
      origin: originFor(l), cost, stage: l.current_stage || (l.has_deal ? "n/a" : "No deal"),
      result, comm, net: comm - (cost || 0), sold, dealId: l.deal_id || "",
      _s: `${l.client_name || ""} ${l.property_address || ""} ${l.deal_name || ""} ${l.email || ""}`.toLowerCase(),
    };
  });
  const soldRows = rows.filter((r) => r.sold);
  const trackedComm = soldRows.reduce((a, r) => a + r.comm, 0);
  const byOrigin = { Dialfire: { n: 0, comm: 0 }, Meta: { n: 0, comm: 0 }, "Seller Lead Bank": { n: 0, comm: 0 } };
  for (const r of soldRows) { const b = byOrigin[r.origin]; if (b) { b.n++; b.comm += r.comm; } }

  // Fallen-through deals are not sales, so they are kept OUT of the attribution
  // table below and surfaced only as a headline count (over the date range).
  const FELL_THROUGH = /FALLEN_THROUGH/;
  const fellThroughCount = sales.filter((d) => FELL_THROUGH.test(d.deal_status || "")).length;

  // ── Attribution detail (matched register rows) ────────────────────────────
  // Attribution detail, with garbage register rows dropped: a future deal date
  // (not a real transfer yet) or a token commission under R100 (a placeholder
  // stub, e.g. the bogus R11 "1 Buh Rein Drive" row matched to a dead deal) must
  // never show as an attributed sale; nor do fallen-through deals (see above).
  const matched = sales.filter((d) => {
    if (!d.lead_matched) return false;
    if (FELL_THROUGH.test(d.deal_status || "")) return false;
    if (d.deal_date_d && d.deal_date_d > _now) return false;
    const gc = num(d.total_gross_comm);
    if (gc > 0 && gc < 100) return false;
    return true;
  }).sort((a, b) => {
    const ta = a.deal_date_d ? a.deal_date_d.getTime() : 0, tb = b.deal_date_d ? b.deal_date_d.getTime() : 0;
    return tb - ta || num(b.total_gross_comm) - num(a.total_gross_comm);
  });
  const dfN = matched.filter((d) => d.lead_origin === "dialfire").length;
  const slbN = matched.length - dfN;
  const byMethod = { email: 0, phone: 0, name: 0, address: 0 };
  for (const d of matched) if (d.match_method && byMethod[d.match_method] != null) byMethod[d.match_method]++;
  const matchedComm = matched.reduce((a, d) => a + num(d.total_gross_comm), 0);

  const originPillAttr = (o) => o === "dialfire"
    ? `<span class="pill" style="background:#E8EEFB;color:${blue};">Dialfire</span>`
    : `<span class="pill" style="background:#FEF3C7;color:#92400E;">Seller Lead Bank</span>`;
  const methodPill = (m) => {
    if (m === "email")   return `<span class="pill" style="background:#E8EEFB;color:#1D4ED8;">email</span>`;
    if (m === "phone")   return `<span class="pill" style="background:#E7F5EC;color:#0F6E3B;">phone</span>`;
    if (m === "name")    return `<span class="pill" style="background:#EEF2F8;color:var(--slate);">name</span>`;
    if (m === "address") return `<span class="pill" style="background:#FDECEC;color:#B91C1C;">address</span>`;
    return `<span class="muted">—</span>`;
  };
  const fmtDate = (d) => d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

  const attrRows = matched.map((d) => {
    const street = [d.street_number, d.street_name].filter(Boolean).join(" ").trim();
    const addr = [street, d.suburb].filter(Boolean).join(", ") || (d.ref_number ? `Ref ${d.ref_number}` : "(no address)");
    const link = d.matched_deal_id
      ? `<a href="${hsDealLink(d.matched_deal_id)}" target="_blank" rel="noopener">${escapeHtml(d.matched_deal_id)} ↗</a>`
      : `<span class="muted">lead had no deal</span>`;
    return `<tr>
      <td style="white-space:nowrap;">${escapeHtml(fmtDate(d.deal_date_d))}</td>
      <td><strong>${escapeHtml(addr)}</strong>${d.division_name ? `<div class="muted small">${escapeHtml(d.division_name)}</div>` : ""}</td>
      <td>${escapeHtml(d.title_code || "—")}</td>
      <td class="num" style="color:${green}; font-weight:700;">${randS(num(d.total_gross_comm))}</td>
      <td>${originPillAttr(d.lead_origin)}</td>
      <td>${methodPill(d.match_method)}</td>
      <td class="num">${link}</td>
      <td>${d.deal_status === "PAID_OUT" ? `<span class="pill" style="background:#E7F5EC;color:#0F6E3B;">paid</span>` : `<span class="pill">${escapeHtml(d.deal_status || "—")}</span>`}</td>
    </tr>`;
  }).join("");

  root.innerHTML = `
    <h2>Lead economics</h2>
    <p class="lede">What each lead channel cost, the commission we can trace back to a paid sale, and exactly how every
      sale was attributed. Follows the sidebar date range; the other sidebar filters do not apply.</p>

    <section class="card" style="margin-top:16px;">
      <h3>Tracked to a sale</h3>
      <p class="section-caption">
        Leads we can trace all the way to a paid sale (matched in the register). Dialfire leads are costed at
        <strong>${dfCost == null ? "n/a" : randS(dfCost)}</strong> each (${randS(STAGES.DIALFIRE_MONTHLY_COST)}/mo &divide; ${grp(dfPerMonth)} deals),
        Meta at <strong>${randS(metaCost)}</strong>; other Seller-Lead-Bank leads carry no direct media cost.
      </p>
      <div class="kpis" style="margin-top:4px;">
        ${card("Leads that sold", grp(soldRows.length), "traced lead → paid sale", green)}
        ${card("Commission from them", randS(trackedComm), "total agency commission", green)}
        ${card("Dialfire", randS(byOrigin.Dialfire.comm), `${grp(byOrigin.Dialfire.n)} sold`, blue)}
        ${card("Meta + Seller Lead Bank", randS(byOrigin.Meta.comm + byOrigin["Seller Lead Bank"].comm), `${grp(byOrigin.Meta.n + byOrigin["Seller Lead Bank"].n)} sold`, yellow)}
        ${card("Fell through", grp(fellThroughCount), "register deals that fell through, in range", red)}
      </div>
    </section>

    <section class="card" style="margin-top:16px;">
      <h3>How each sale was matched</h3>
      <p class="section-caption">
        Every register sale we could map back to a lead, and the signal we matched it on, strongest first:
        ${methodPill("email")} seller email · ${methodPill("phone")} seller cellphone · ${methodPill("name")} full name ·
        ${methodPill("address")} house number + street (fuzzy). Counts: ${grp(byMethod.email)} email, ${grp(byMethod.phone)} phone, ${grp(byMethod.name)} name, ${grp(byMethod.address)} address.
      </p>
      <div class="kpis" style="margin-top:4px;">
        ${card("Attributed sales", grp(matched.length), `of ${grp(sales.length)} register deals traced to a lead`, blue)}
        ${card("Dialfire", grp(dfN), "auto-created by the calling pipe", blue)}
        ${card("Seller Lead Bank", grp(slbN), "from the sheet lead book", yellow)}
        ${card("Commission on matched", randS(matchedComm), "gross, incl. provisional", green)}
      </div>
      <div class="table-wrap" style="margin-top:12px;"><table class="dt">
        <thead><tr>
          <th>Deal date</th><th>Address</th><th>Type</th>
          <th class="num">Commission</th><th>Origin</th><th>Matched by</th>
          <th class="num">HubSpot deal</th><th>Status</th>
        </tr></thead>
        <tbody>${attrRows || `<tr><td colspan="8" class="muted" style="padding:18px;">No sales matched to a lead yet.</td></tr>`}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px;">
        Attribution is a floor, not the full picture: it only counts sales where the seller is identifiable in our lead
        data (historically about 1 in 6). FT = Freehold Title (houses), ST = Sectional Title (apartments / flats / townhouses).
      </p>
    </section>
  `;
};
