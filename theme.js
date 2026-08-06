// Chart palette + stage-color helper. Mirrors quay-leads-dashboard/lib/theme.py.
window.THEME = (() => {
  const tokens = {
    paper: "#EEF2F8", card: "#FFFFFF", line: "#E0E7F1",
    ink: "#1A2746", slate: "#4A566D", muted: "#6B7891",
    yellow: "#FDC503", yellowDeep: "#B98A02",
    sky: "#98C5ED", skyDeep: "#2E6FB0",
    green: "#2F8F63", amber: "#B98A02", red: "#D20A03",
    blue: "#3D5BA6",
    hotRed: "#FF3B30", warmAmber: "#F59E0B", noDealGrey: "#CBD5E1",
  };

  const PALETTE = [
    tokens.blue, tokens.skyDeep, tokens.yellowDeep, tokens.green, tokens.red,
    tokens.ink, "#7C3AED", "#0EA5E9", "#F97316", "#0F766E", "#9CA3AF",
  ];

  // Stage label → color. Hot pops red; cool stages fade.
  const SEMANTICS = [
    ["hot",         tokens.hotRed],
    ["competitor",  "#B91C1C"],   // sold by a competitor (lost) — deep red, BEFORE "listed"
    ["sold",        tokens.green], // sold by us (won) — green
    ["warm",        tokens.warmAmber],
    ["no deal",     tokens.noDealGrey],
    ["calling",     tokens.blue],
    ["inbound",     "#0EA5E9"],
    ["nurture",     "#EC4899"],   // Lead to Nurture — its own pink, no longer blends into grey
    ["external",    "#7C3AED"],
    ["listed",      tokens.yellowDeep],
    ["not my area", "#9CA3AF"],
    ["delete",      "#9CA3AF"],
    ["rentals",     "#0F766E"],
  ];

  function stageColors(stages) {
    const reserved = new Set([tokens.hotRed, "#B91C1C", "#EC4899", tokens.green, tokens.warmAmber, tokens.noDealGrey, tokens.yellowDeep]);
    const leftover = PALETTE.filter(c => !reserved.has(c));
    let li = 0;
    const out = {};
    for (const s of stages) {
      const sl = (s || "").toLowerCase();
      const match = SEMANTICS.find(([needle]) => sl.includes(needle));
      if (match) {
        out[s] = match[1];
      } else {
        out[s] = leftover[li % leftover.length];
        li++;
      }
    }
    return out;
  }

  const BASE_PLOTLY_LAYOUT = {
    paper_bgcolor: tokens.card,
    plot_bgcolor: tokens.card,
    font: { color: tokens.ink, family: "Montserrat, system-ui, sans-serif", size: 12 },
    colorway: PALETTE,
    margin: { l: 44, r: 24, t: 24, b: 36 },
    xaxis: { gridcolor: tokens.line, zerolinecolor: tokens.line, linecolor: tokens.line,
             tickfont: { color: tokens.muted } },
    yaxis: { gridcolor: tokens.line, zerolinecolor: tokens.line, linecolor: tokens.line,
             tickfont: { color: tokens.muted } },
    legend: { bgcolor: "rgba(0,0,0,0)", font: { color: tokens.slate } },
    hoverlabel: { bgcolor: tokens.card, font: { color: tokens.ink }, bordercolor: tokens.line },
  };

  const PLOTLY_CONFIG = { displayModeBar: false, responsive: true };

  // Plotly MUTATES the layout object it is given (e.g. it stamps
  // xaxis.type = "date" on a chart with date x-values). Because every view
  // spreads this shared layout, that mutation used to leak: once a date-based
  // line chart ran, later bar charts inherited xaxis.type "date" and rendered
  // their numeric values as epoch-millisecond timestamps (bars collapsed at
  // 1970 → looked empty). Hand out a fresh deep clone on every access so no
  // chart can pollute another's axes.
  return {
    tokens, PALETTE, stageColors, PLOTLY_CONFIG,
    get PLOTLY_LAYOUT() { return structuredClone(BASE_PLOTLY_LAYOUT); },
  };
})();
