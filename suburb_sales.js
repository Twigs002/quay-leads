// Suburb sales reference data — average sale prices per suburb + title type.
// ============================================================================
// Real, mapped data. Append one row per (team, suburb, type) as the numbers
// come in (or swap this file for a Supabase-backed fetch). Store RAW numbers
// only — the Costings view formats them for display.
//
// Type codes: FT = Freehold Title (houses), ST = Sectional Title (apartments /
// flats / townhouses / duplexes). A lead's property_type is mapped to one of
// these by titleCode() below, then matched to a row by suburb + type.
//
// Fields: 2025 avg price, total spend (rand traded), number of sales, median
// price, average rand per m2, average days on market. Rows added later may
// carry only team/suburb/type/avg_price — the extra stats are optional.
window.SUBURB_SALES = (() => {
  const YEAR = 2025;

  // false = these are the real mapped numbers (drops the "placeholder" badge).
  const PLACEHOLDER = false;

  const ROWS = [
    {
      team: "Assassins", suburb: "Vredehoek", type: "FT",
      avg_price: 6341674, total_spend: 272692000, num_sales: 43,
      median_price: 6325000, avg_rate_per_m2: 16591, avg_days_on_market: 66,
    },
    {
      team: "Assassins", suburb: "Vredehoek", type: "ST",
      avg_price: 3354116,
    },
  ];

  // Map a raw property_type string to a title code. Apartments/flats/townhouses
  // are Sectional Title; houses are Freehold Title. Anything else (land, erf,
  // commercial, survey junk, blanks) returns null = no match. Checks ST terms
  // first so "sectional title house" reads as ST, not FT.
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

  return { YEAR, PLACEHOLDER, ROWS, titleCode, find };
})();
