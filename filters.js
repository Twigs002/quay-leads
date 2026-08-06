// Global filter state + sidebar wiring.
// Multi-selects use <details> for the disclosure pattern with live
// checkboxes inside — mirrors Streamlit's st.multiselect UX.
window.FILTERS = (() => {
  const state = {
    from: null, to: null,
    range: "90d",          // active quick-range preset (or "custom")
    maxDate: null,         // latest lead date — presets anchor to this
    divisions: new Set(),
    sources: new Set(),
    leadTypes: new Set(),
    noDealOnly: false,
    // Where the lead originated: null = all, "dialfire" = deal auto-created by
    // the calling pipe (deal_creation === 'auto'), "slb" = everything else
    // (came in through the Seller Lead Bank sheet, not the Dialfire pipe).
    leadOrigin: null,
  };
  const listeners = [];

  function notify() { for (const fn of listeners) fn(state); }
  function onChange(fn) { listeners.push(fn); }

  // ── SAST-correct date boundaries ────────────────────────────────────
  // datestamp is stored as a UTC instant (synced from SAST). Native
  // <input type=date> values and default ranges must be interpreted in
  // SAST (UTC+2, no DST) or boundary days drift by one. All conversions
  // below go through Africa/Johannesburg so picking "30 Jul" means the
  // full SAST calendar day, not UTC midnight.
  const SAST_TZ = "Africa/Johannesburg";
  const ymdOf   = (d) => d ? d.toLocaleDateString("en-CA", { timeZone: SAST_TZ }) : "";
  const dayStart = (ymd) => ymd ? new Date(`${ymd}T00:00:00+02:00`) : null;
  const dayEnd   = (ymd) => ymd ? new Date(`${ymd}T23:59:59.999+02:00`) : null;

  const PRESETS = {
    "30d": { days: 30 },
    "90d": { days: 90 },
    "6m":  { months: 6 },
    "12m": { months: 12 },
    "all": {},
  };

  // Set state.from/to for a preset, anchored to TODAY. (Not the latest
  // lead date: a handful of leads carry bad future datestamps, which would
  // otherwise push the default "last 90 days" window into an empty future.)
  function applyPreset(key) {
    state.range = key;
    if (key === "custom") return;               // driven by the date inputs
    if (key === "all") { state.from = null; state.to = null; return; }
    const anchor = new Date();
    const p = PRESETS[key] || PRESETS["90d"];
    const start = new Date(anchor);
    if (p.days)   start.setDate(start.getDate() - p.days);
    if (p.months) start.setMonth(start.getMonth() - p.months);
    state.from = dayStart(ymdOf(start));
    state.to   = dayEnd(ymdOf(anchor));
  }

  function setDefault(leads) {
    const dates = leads.map(l => l.datestamp_d).filter(Boolean).sort((a, b) => a - b);
    state.maxDate = dates.length ? dates[dates.length - 1] : null;
    applyPreset(state.range);                   // default "90d"
  }

  function uniq(leads, key) {
    return Array.from(new Set(
      leads.map(l => l[key]).filter(v => v && String(v).trim())
    )).sort();
  }

  function renderMulti(id, values, target) {
    const list = document.querySelector(`.multi-list[data-target="${id}"]`);
    list.innerHTML = "";
    if (!values.length) {
      list.innerHTML = '<div class="empty">no options</div>';
      return;
    }
    for (const v of values) {
      const lbl = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = v; cb.checked = target.has(v);
      cb.addEventListener("change", () => {
        if (cb.checked) target.add(v); else target.delete(v);
        updateSummary(id, target, values.length);
        notify();
      });
      const txt = document.createElement("span");
      txt.textContent = v;
      lbl.appendChild(cb); lbl.appendChild(txt);
      list.appendChild(lbl);
    }
    updateSummary(id, target, values.length);
  }

  function updateSummary(id, target, total) {
    const $sum = document.querySelector(`#${id} summary .summary-value`);
    if (!$sum) return;
    if (target.size === 0) {
      $sum.textContent = "All";
      $sum.classList.remove("selected");
    } else if (target.size === total) {
      $sum.textContent = `All (${total})`;
      $sum.classList.remove("selected");
    } else if (target.size <= 2) {
      $sum.textContent = Array.from(target).join(", ");
      $sum.classList.add("selected");
    } else {
      $sum.textContent = `${target.size} selected`;
      $sum.classList.add("selected");
    }
  }

  function wireSearch(id) {
    const $in = document.querySelector(`.multi-search[data-target="${id}"]`);
    if (!$in) return;
    $in.addEventListener("input", () => {
      const q = $in.value.toLowerCase().trim();
      const labels = document.querySelectorAll(`.multi-list[data-target="${id}"] label`);
      for (const lbl of labels) {
        const txt = lbl.querySelector("span").textContent.toLowerCase();
        lbl.style.display = !q || txt.includes(q) ? "" : "none";
      }
    });
  }

  function populateOptions(leads) {
    renderMulti("ms-division", uniq(leads, "division"), state.divisions);
    renderMulti("ms-source",   uniq(leads, "source"),   state.sources);
    renderMulti("ms-leadtype", uniq(leads, "is_lead"),  state.leadTypes);
    wireSearch("ms-division");
    wireSearch("ms-source");
  }

  // Human label for the range field, e.g. "01 May 2026 – 30 Jul 2026".
  function rangeLabel() {
    if (!state.from && !state.to) return "All dates";
    const f = (d) => d
      ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: SAST_TZ })
      : "…";
    return `${f(state.from)} - ${f(state.to)}`;
  }

  function wireSidebar() {
    const $presets = document.getElementById("range-presets");
    const $input = document.getElementById("date-range-input");
    const $nodeal = document.getElementById("f-nodeal");
    const $reset = document.getElementById("f-reset");

    function refreshInput() { $input.value = rangeLabel(); }
    function reflectRange() {
      $presets.querySelectorAll("button").forEach(b =>
        b.classList.toggle("active", b.dataset.range === state.range));
    }

    // Calendar range picker (Litepicker) — the primary date control.
    let programmatic = false;   // guard so setDateRange() doesn't re-fire 'selected'
    // One month on phones so the two-up calendar never overflows a 375px screen.
    const narrowScreen = window.matchMedia("(max-width: 640px)").matches;
    const picker = new Litepicker({
      element: $input,
      singleMode: false,
      numberOfMonths: narrowScreen ? 1 : 2,
      numberOfColumns: narrowScreen ? 1 : 2,
      format: "DD MMM YY",
      // Month + year dropdowns in the header → jump straight to any
      // month/year instead of clicking the arrows (e.g. Jan 2025 → Feb 2026).
      dropdowns: {
        months: true,
        years: true,
        minYear: (state.maxDate ? state.maxDate.getFullYear() : new Date().getFullYear()) - 8,
        maxYear: new Date().getFullYear(),
      },
      startDate: state.from ? ymdOf(state.from) : null,
      endDate:   state.to   ? ymdOf(state.to)   : null,
      setup: (p) => {
        p.on("selected", (d1, d2) => {
          if (programmatic) return;
          // Use the picked calendar day and pin it to SAST boundaries.
          state.range = "custom";
          state.from = dayStart(d1.format("YYYY-MM-DD"));
          state.to   = dayEnd(d2.format("YYYY-MM-DD"));
          refreshInput(); reflectRange(); notify();
        });
      },
    });

    // Push state.from/to into the picker + field without firing 'selected'.
    function pushToPicker() {
      programmatic = true;
      if (state.from && state.to) picker.setDateRange(ymdOf(state.from), ymdOf(state.to));
      else picker.clearSelection();
      programmatic = false;
      refreshInput();
    }

    $presets.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-range]");
      if (!btn) return;
      applyPreset(btn.dataset.range);
      pushToPicker();
      reflectRange();
      notify();
    });

    // Lead source segmented control (All / Dialfire / Seller Lead Bank).
    const $origin = document.getElementById("lead-origin");
    function reflectOrigin() {
      if (!$origin) return;
      const key = state.leadOrigin || "all";
      $origin.querySelectorAll("button").forEach(b =>
        b.classList.toggle("active", b.dataset.origin === key));
    }
    if ($origin) {
      $origin.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-origin]");
        if (!btn) return;
        state.leadOrigin = btn.dataset.origin === "all" ? null : btn.dataset.origin;
        reflectOrigin();
        notify();
      });
    }

    $nodeal.addEventListener("change", () => {
      state.noDealOnly = $nodeal.checked; notify();
    });
    $reset.addEventListener("click", () => {
      state.divisions.clear(); state.sources.clear(); state.leadTypes.clear();
      state.noDealOnly = false;
      state.leadOrigin = null;
      reflectOrigin();
      $nodeal.checked = false;
      document.querySelectorAll(".multi-list input[type=checkbox]")
        .forEach(cb => cb.checked = false);
      ["ms-division", "ms-source", "ms-leadtype"].forEach(id => {
        const $sum = document.querySelector(`#${id} summary .summary-value`);
        if ($sum) { $sum.textContent = "All"; $sum.classList.remove("selected"); }
      });
      applyPreset("90d");    // dates snap back to the default window too
      pushToPicker();
      reflectRange();
      notify();
    });

    reflectRange();
    reflectOrigin();
    refreshInput();

    // Click outside any open dropdown to close it.
    document.addEventListener("click", (e) => {
      document.querySelectorAll("details.multi[open]").forEach(d => {
        if (!d.contains(e.target)) d.removeAttribute("open");
      });
    });
  }

  function apply(leads) {
    return leads.filter(l => {
      if (state.from && (!l.datestamp_d || l.datestamp_d < state.from)) return false;
      if (state.to   && (!l.datestamp_d || l.datestamp_d > state.to)) return false;
      if (state.divisions.size && !state.divisions.has(l.division)) return false;
      if (state.sources.size && !state.sources.has(l.source)) return false;
      if (state.leadTypes.size && !state.leadTypes.has(l.is_lead)) return false;
      if (state.noDealOnly && l.has_deal) return false;
      if (state.leadOrigin === "dialfire" && l.deal_creation !== "auto") return false;
      if (state.leadOrigin === "slb" && l.deal_creation === "auto") return false;
      return true;
    });
  }

  return { state, onChange, setDefault, populateOptions, wireSidebar, apply };
})();
