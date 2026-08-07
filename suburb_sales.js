// Suburb sales reference data — average sale prices per suburb + title type.
// ============================================================================
// Now DATA-DRIVEN from the commission register (public.sales_deals). ROWS are
// rebuilt from actual PAID_OUT, non-rental sales via buildFromRegister(), which
// data.js calls after loading. Until then (or for non-super users who get no
// register rows) a tiny fallback keeps the interface working.
//
// Type codes: FT = Freehold Title (houses), ST = Sectional Title (apartments /
// flats / townhouses / duplexes). A lead's property_type is mapped to one of
// these by titleCode(); register rows already carry title_code from the sync.
//
// Row fields: team (the division with the most sales there), suburb, type,
// avg_price, total_spend, num_sales, median_price, avg_q1_comm (REAL average
// Quay 1 commission banked per sale). m2 / days-on-market aren't in the register
// so those stay null (shown as n/a).
window.SUBURB_SALES = (() => {
  const YEAR = 2025;
  const PLACEHOLDER = false;

  // Minimum sales in a suburb+type before we trust the average (avoids a single
  // outlier defining a suburb). Rows below this are dropped from ROWS.
  const MIN_SALES = 3;
  // Ignore obvious junk/test rows (price near zero) in the average.
  const MIN_PRICE = 10000;

  // Fallback until the register loads (keeps find() working; overwritten by
  // buildFromRegister on first load).
  let ROWS = [
    { team: "Assassins", suburb: "Vredehoek", type: "ST", avg_price: 2887289, num_sales: 45, median_price: 2900000, avg_q1_comm: 60559 },
    { team: "Assassins", suburb: "Vredehoek", type: "FT", avg_price: 6750000, num_sales: 12, median_price: 6750000, avg_q1_comm: 160277 },
  ];

  const _num = v => (v == null || v === "") ? null : (isNaN(+v) ? null : +v);
  const _median = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const _mode = arr => {
    const c = {};
    let best = null, bestN = 0;
    for (const v of arr) { if (!v) continue; c[v] = (c[v] || 0) + 1; if (c[v] > bestN) { bestN = c[v]; best = v; } }
    return best;
  };

  // Rebuild ROWS from register rows (public.sales_deals shape). Only PAID_OUT,
  // non-rental sales with a real FT/ST code and a sane price feed the averages.
  function buildFromRegister(rows) {
    if (!Array.isArray(rows) || !rows.length) return ROWS;
    const groups = new Map();   // "suburb|CODE" -> {prices:[], comms:[], teams:[], suburb, type}
    for (const r of rows) {
      if (r.deal_status !== "PAID_OUT" || r.is_rental) continue;
      const code = r.title_code;
      if (code !== "FT" && code !== "ST") continue;
      const price = _num(r.purchase_price);
      if (price == null || price < MIN_PRICE) continue;
      const sub = String(r.suburb || "").trim();
      if (!sub) continue;
      const key = sub.toLowerCase() + "|" + code;
      let g = groups.get(key);
      if (!g) { g = { suburb: sub, type: code, prices: [], comms: [], teams: [] }; groups.set(key, g); }
      g.prices.push(price);
      const q = _num(r.quay1_gross_comm); if (q != null) g.comms.push(q);
      if (r.division_name) g.teams.push(r.division_name);
    }
    const built = [];
    for (const g of groups.values()) {
      if (g.prices.length < MIN_SALES) continue;
      const sum = g.prices.reduce((a, b) => a + b, 0);
      built.push({
        team: _mode(g.teams) || "",
        suburb: g.suburb,
        type: g.type,
        avg_price: Math.round(sum / g.prices.length),
        total_spend: Math.round(sum),
        num_sales: g.prices.length,
        median_price: Math.round(_median(g.prices)),
        avg_q1_comm: g.comms.length ? Math.round(g.comms.reduce((a, b) => a + b, 0) / g.comms.length) : null,
        // Not available in the register:
        avg_rate_per_m2: null,
        avg_days_on_market: null,
      });
    }
    if (built.length) {
      built.sort((a, b) => b.num_sales - a.num_sales);
      ROWS = built;
    }
    return ROWS;
  }

  // Map a raw property_type string to a title code (used for LEAD property types,
  // which are free text). ST terms checked first so "sectional title house" = ST.
  function titleCode(propertyType) {
    const s = String(propertyType || "").toLowerCase();
    if (!s) return null;
    if (/apartment|flat|sectional|townhouse|duplex|maisonette/.test(s)) return "ST";
    if (/\bhouse\b/.test(s)) return "FT";
    return null;
  }

  // Find the sales row for a given suburb + raw property_type, or null.
  function find(suburb, propertyType) {
    const code = titleCode(propertyType);
    if (!code) return null;
    const s = String(suburb || "").trim().toLowerCase();
    if (!s) return null;
    return ROWS.find(r => r.suburb.toLowerCase() === s && r.type === code) || null;
  }

  return {
    YEAR, PLACEHOLDER,
    get ROWS() { return ROWS; },
    titleCode, find, buildFromRegister,
  };
})();
