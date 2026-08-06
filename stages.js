// Shared HubSpot deal-stage vocabulary for the whole dashboard.
// One source of truth so every view orders stages the same way HubSpot
// does, and agrees on what "qualified", "won", "lost" and "out of area"
// mean. Stage strings match hs_deal_state.current_stage (the readable
// label the sync writes, not the internal id).
window.STAGES = (() => {
  // Canonical pipeline order, exactly as it reads in HubSpot. Index in this
  // array is the sort key for every stage chart/table (item: "chronological
  // order required — match this to HubSpot").
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

  const WON  = "Sold";                    // sold by us
  const LOST = "Listed with Competitor";  // sold by a competitor
  const NURTURE = "Contacted - Lead to Nurture";
  const OUT_OF_AREA = "Not My Area";      // HubSpot's own out-of-farming-area marker

  // "Meta lead" detection for the R100-per-lead cost model. Sheet Source
  // values vary (Facebook, Meta, FB Lead Ad, …) so match loosely and
  // surface what matched in the UI so a wrong catch is obvious.
  const META_SOURCE_RE = /\b(meta|facebook|fb)\b/i;
  const META_COST_PER_LEAD = 80;    // R per meta lead
  const QUALIFIED_TARGET_COST = 5000; // R reference line ("R5k")
  const COMMISSION_RATE = 0.042;    // average commission we earn on a sale (4.2%)

  // Sort key: known stages by pipeline order, unknowns after, "No deal yet"
  // last of all. Used as `arr.sort((a,b)=>orderIndex(a)-orderIndex(b))`.
  function orderIndex(stage) {
    if (!stage || stage === "No deal yet") return ORDER.length + 1;
    const i = ORDER.indexOf(stage);
    return i === -1 ? ORDER.length : i;
  }

  function isQualified(stage) { return QUALIFIED.has(stage); }
  function isMetaSource(src)  { return META_SOURCE_RE.test(src || ""); }

  return {
    ORDER, QUALIFIED, WON, LOST, NURTURE, OUT_OF_AREA,
    META_SOURCE_RE, META_COST_PER_LEAD, QUALIFIED_TARGET_COST, COMMISSION_RATE,
    orderIndex, isQualified, isMetaSource,
  };
})();
