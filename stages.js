// Shared HubSpot deal-stage vocabulary for the whole dashboard.
// One source of truth so every view orders stages the same way HubSpot
// does, and agrees on what "qualified", "won", "lost" and "out of area"
// mean. Stage strings match hs_deal_state.current_stage (the readable
// label the sync writes, not the internal id).
window.STAGES = (() => {
  // Canonical pipeline order, exactly as it reads in HubSpot. Index in this
  // array is the sort key for every stage chart/table (item: "chronological
  // order required - match this to HubSpot").
  const ORDER = [
    "Calling Lead",
    "External Lead",
    "Inbound Lead",
    "Rental Lead",
    "Reconverted Lead",
    "Contacted - Lead to Nurture",
    "Contacted - Warm Lead (Courtesy)",
    "Contacted - Hot Lead",
    "Listed - Sole Mandate",
    "Listed - Other Mandate",
    "Listed with Competitor",
    "Sold",
    "Referred to Rentals",
    "Let By Us",
    "Not My Area",
    "Please delete (Provide note)",
    "Past Let - Leakage",
  ];

  // A lead counts as "qualified" once its deal reaches warm, hot, any
  // mandate, or sold. Drives cost-per-qualified-lead on the Overview.
  const QUALIFIED = new Set([
    "Contacted - Warm Lead (Courtesy)",
    "Contacted - Hot Lead",
    "Listed - Sole Mandate",
    "Listed - Other Mandate",
    "Sold",
  ]);

  const WON  = "Sold";                    // closed sale by us
  const LOST = "Listed with Competitor";  // listed elsewhere
  const NURTURE = "Contacted - Lead to Nurture";
  const OUT_OF_AREA = "Not My Area";      // HubSpot's own out-of-farming-area marker

  // Won-the-listing milestones. In this book almost nothing reaches "Sold"
  // (a couple of deals total) because closed sales aren't tracked to completion
  // in HubSpot; winning the MANDATE is the realistic point our commission is
  // secured, so break-even / expected-value uses it as the sale proxy.
  const MANDATE = new Set(["Listed - Sole Mandate", "Listed - Other Mandate"]);
  // Competitor outcomes = lost to us. HubSpot carries two: they listed with a
  // competitor, or a competitor closed the sale.
  const COMPETITOR_LOST = new Set(["Listed with Competitor", "Sold by Competitor"]);

  // "Meta lead" detection for the R100-per-lead cost model. Sheet Source
  // values vary (Facebook, Meta, FB Lead Ad, …) so match loosely and
  // surface what matched in the UI so a wrong catch is obvious.
  const META_SOURCE_RE = /\b(meta|facebook|fb)\b/i;
  const META_COST_PER_LEAD = 80;    // R per meta lead
  const QUALIFIED_TARGET_COST = 5000; // R reference line ("R5k")
  // Total agency commission headline (what the client is quoted). Real register
  // data shows ~5% gross; 4.2% is the conservative planning figure. This is NOT
  // what Quay keeps - the broker split takes roughly half.
  const COMMISSION_RATE = 0.042;    // total agency commission (headline)
  // What Quay 1 actually RETAINS after the broker split - measured from the
  // commission register (median 2.0%, weighted 1.94% of sale price). This is the
  // figure every projection uses, so the model matches the money that hits the
  // bank. Real per-suburb banked commission (suburb row avg_q1_comm) is used in
  // preference to this rate wherever a suburb is mapped.
  const QUAY_COMMISSION_RATE = 0.02;

  // Outbound calling (Dialfire) monthly running cost. Two assumptions the user
  // owns (adjust here and every view follows): the caller team's salaries, and
  // the dialer + telephony spend (~R45-50k, midpoint used). A "Dialfire lead"
  // is a deal the calling pipe auto-creates (deal_creation === 'auto'), so the
  // cost per Dialfire lead = this monthly cost / auto deals produced that month.
  const CALLER_SALARIES_MONTHLY = 398000;   // R/month, outbound caller salaries
  const CALLING_COST_MONTHLY    = 47500;    // R/month, dialer + telephony (~R45-50k)
  const DIALFIRE_MONTHLY_COST   = CALLER_SALARIES_MONTHLY + CALLING_COST_MONTHLY;
  // Fallback monthly Dialfire-lead volume, used only until deal_created dates
  // reach the browser (migration + reload). Measured 2026-08-06 as the mean of
  // the last 3 complete months (May 226, Jun 322, Jul 300 auto deals).
  const DIALFIRE_LEADS_PER_MONTH_FALLBACK = 283;

  // Sort key: known stages by pipeline order, unknowns after, "No deal yet"
  // last of all. Used as `arr.sort((a,b)=>orderIndex(a)-orderIndex(b))`.
  function orderIndex(stage) {
    if (!stage || stage === "No deal yet") return ORDER.length + 1;
    const i = ORDER.indexOf(stage);
    return i === -1 ? ORDER.length : i;
  }

  function isQualified(stage) { return QUALIFIED.has(stage); }
  function isMetaSource(src)  { return META_SOURCE_RE.test(src || ""); }
  function isMandate(stage)   { return MANDATE.has(stage); }
  // Won the listing = has a mandate, or the rare fully-closed sale.
  function isWonListing(stage){ return MANDATE.has(stage) || stage === WON; }
  function isLost(stage)      { return COMPETITOR_LOST.has(stage); }

  return {
    ORDER, QUALIFIED, WON, LOST, NURTURE, OUT_OF_AREA, MANDATE, COMPETITOR_LOST,
    META_SOURCE_RE, META_COST_PER_LEAD, QUALIFIED_TARGET_COST, COMMISSION_RATE,
    QUAY_COMMISSION_RATE,
    CALLER_SALARIES_MONTHLY, CALLING_COST_MONTHLY, DIALFIRE_MONTHLY_COST,
    DIALFIRE_LEADS_PER_MONTH_FALLBACK,
    orderIndex, isQualified, isMetaSource, isMandate, isWonListing, isLost,
  };
})();
