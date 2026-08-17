// Attribution — per-deal view of how each register sale was mapped back to a
// lead. One row per ATTRIBUTED (matched) sale: address, commission, origin
// (Dialfire vs Seller Lead Bank), the signal we matched it on (phone / name /
// address), and a link to the exact HubSpot deal it was matched to. The match
// itself runs in the sync using seller PII in memory; only the outcome is
// stored (no client PII), and this view just surfaces that outcome. Super/admin
// only, and it reads the whole register (ignores the sidebar filters).
window.VIEWS = window.VIEWS || {};
window.VIEWS.attribution = function (root, ctx) {
  if (!(ctx.user && (ctx.user.isSuper || ctx.user.isAdmin))) {
    root.innerHTML = `<h2>Attribution</h2>
      <div class="card" style="padding:20px;"><p class="muted">This page is restricted to super and admin users.</p></div>`;
    return;
  }

  const { escapeHtml, hsDealLink } = UTILS;
  const grp = n => Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const randS = v => "R " + grp(v);
  const num = v => (v == null || v === "") ? 0 : (Number(v) || 0);
  const green = THEME.tokens.green, blue = THEME.tokens.blue, yellow = THEME.tokens.yellowDeep;

  const all = (ctx.cache && ctx.cache.salesDeals) || [];

  if (!all.length) {
    root.innerHTML = `
      <h2>Attribution</h2>
      <p class="lede">How each sale was mapped back to the lead that generated it.</p>
      <section class="card" style="margin-top:16px; padding:20px;">
        <h3>Waiting for the register</h3>
        <p class="muted">No sales-register rows loaded yet. This populates once the register migration is applied and the
        register sheet is shared with the sync service account. It refreshes on the 30-minute sync.</p>
      </section>`;
    return;
  }

  // Matched sales only (the ones we could trace to a lead). Paid + open both
  // carry attribution; show all matched, most recent first.
  const matched = all.filter(d => d.lead_matched)
    .sort((a, b) => {
      const ta = a.deal_date_d ? a.deal_date_d.getTime() : 0;
      const tb = b.deal_date_d ? b.deal_date_d.getTime() : 0;
      return tb - ta || num(b.total_gross_comm) - num(a.total_gross_comm);
    });

  const paid = all.filter(d => d.deal_status === "PAID_OUT");
  const dfN = matched.filter(d => d.lead_origin === "dialfire").length;
  const slbN = matched.length - dfN;
  const byMethod = { email: 0, phone: 0, name: 0, address: 0 };
  for (const d of matched) if (d.match_method && byMethod[d.match_method] != null) byMethod[d.match_method]++;
  const matchedComm = matched.reduce((a, d) => a + num(d.total_gross_comm), 0);

  // Origin + method pills (method doubles as a confidence signal: email/phone
  // are the strongest, address the fuzziest).
  const originPill = o => o === "dialfire"
    ? `<span class="pill" style="background:#E8EEFB;color:${blue};">Dialfire</span>`
    : `<span class="pill" style="background:#FEF3C7;color:#92400E;">Seller Lead Bank</span>`;
  const methodPill = m => {
    if (m === "email")   return `<span class="pill" style="background:#E8EEFB;color:#1D4ED8;">email</span>`;
    if (m === "phone")   return `<span class="pill" style="background:#E7F5EC;color:#0F6E3B;">phone</span>`;
    if (m === "name")    return `<span class="pill" style="background:#EEF2F8;color:var(--slate);">name</span>`;
    if (m === "address") return `<span class="pill" style="background:#FDECEC;color:#B91C1C;">address</span>`;
    return `<span class="muted">—</span>`;
  };
  const fmtDate = d => d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

  function card(label, value, sub, accent) {
    return `<div class="kpi"${accent ? ` style="border-left:4px solid ${accent};"` : ""}>
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${sub ? `<div class="delta-row muted small">${sub}</div>` : ""}
    </div>`;
  }

  const rowsHtml = matched.map(d => {
    const street = [d.street_number, d.street_name].filter(Boolean).join(" ").trim();
    const addr = [street, d.suburb].filter(Boolean).join(", ") || (d.ref_number ? `Ref ${d.ref_number}` : "(no address)");
    const link = d.matched_deal_id
      ? `<a href="${hsDealLink(d.matched_deal_id)}" target="_blank" rel="noopener">${escapeHtml(d.matched_deal_id)} ↗</a>`
      : `<span class="muted">lead had no deal</span>`;
    return `<tr>
      <td class="tnum" style="white-space:nowrap;">${escapeHtml(fmtDate(d.deal_date_d))}</td>
      <td><strong>${escapeHtml(addr)}</strong>${d.division_name ? `<div class="muted small">${escapeHtml(d.division_name)}</div>` : ""}</td>
      <td>${escapeHtml(d.title_code || "—")}</td>
      <td class="num" style="color:${green}; font-weight:700;">${randS(num(d.total_gross_comm))}</td>
      <td>${originPill(d.lead_origin)}</td>
      <td>${methodPill(d.match_method)}</td>
      <td class="num">${link}</td>
      <td>${d.deal_status === "PAID_OUT" ? `<span class="pill" style="background:#E7F5EC;color:#0F6E3B;">paid</span>` : `<span class="pill">${escapeHtml(d.deal_status || "—")}</span>`}</td>
    </tr>`;
  }).join("");

  root.innerHTML = `
    <h2>Attribution</h2>
    <p class="lede">
      Every sale we could map back to a lead, and exactly what we mapped it by. Matching runs privately in the sync
      on seller email / phone / name / address — only the result is stored, never the client's details. Whole register; not narrowed by the filters.
    </p>

    <div class="kpis" style="margin-top:16px;">
      ${card("Attributed sales", grp(matched.length), `of ${grp(paid.length)} paid deals traceable`, blue)}
      ${card("Dialfire", grp(dfN), "deal auto-created by the calling pipe", blue)}
      ${card("Seller Lead Bank", grp(slbN), "from the sheet lead book", yellow)}
      ${card("Commission traced", randS(matchedComm), "on matched sales", green)}
    </div>

    <section class="card" style="margin-top:16px;">
      <h3>How each sale was matched</h3>
      <p class="section-caption">
        <strong>Matched by</strong> is the signal we mapped it on, strongest first:
        ${methodPill("email")} seller email (exact) · ${methodPill("phone")} seller cellphone (exact) · ${methodPill("name")} full name (token match) ·
        ${methodPill("address")} house number + street (fuzzy). Counts: ${grp(byMethod.email)} email, ${grp(byMethod.phone)} phone, ${grp(byMethod.name)} name, ${grp(byMethod.address)} address.
        The link opens the exact HubSpot deal the sale was matched to.
      </p>
      <div class="table-wrap" style="margin-top:12px;"><table class="dt">
        <thead><tr>
          <th>Deal date</th><th>Address</th><th>Type</th>
          <th class="num">Commission</th><th>Origin</th><th>Matched by</th>
          <th class="num">HubSpot deal</th><th>Status</th>
        </tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="8" class="muted" style="padding:18px;">No sales matched to a lead yet.</td></tr>`}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px;">
        Attribution is a floor, not the full picture: it only counts sales where the seller is identifiable in our lead
        data (historically about 1 in 6). FT = Freehold Title (houses), ST = Sectional Title (apartments / flats / townhouses).
      </p>
    </section>
  `;
};
