// Suburb sales reference data — average sale prices per suburb.
// ============================================================================
// PLACEHOLDER. Right now this holds a single sample row so the Costings page
// renders. When the real numbers are ready we map the full "average sales
// price per suburb" set in here (or swap this file for a Supabase-backed
// fetch). Store RAW numbers only — the Costings view formats them for display,
// so real data drops straight in.
//
// Type codes: FT = Freehold Title, ST = Sectional Title.
// Fields: 2025 avg price, total spend (rand traded), number of sales, median
// price, average rand per m2, average days on market.
window.SUBURB_SALES = (() => {
  const YEAR = 2025;

  // true while these are sample numbers, not the mapped data set. The view
  // shows a clear "placeholder" banner until this flips to false.
  const PLACEHOLDER = true;

  const ROWS = [
    {
      suburb: "Vredehoek",
      type: "FT",
      avg_price: 6341674,
      total_spend: 272692000,
      num_sales: 43,
      median_price: 6325000,
      avg_rate_per_m2: 16591,
      avg_days_on_market: 66,
    },
  ];

  return { YEAR, PLACEHOLDER, ROWS };
})();
