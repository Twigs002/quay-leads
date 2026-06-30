// Global filter state, shared across views.
// Stored in URL hash so refreshes preserve the user's view.
window.FILTERS = (() => {
  const state = {
    from: null, to: null,
    divisions: new Set(),
    sources: new Set(),
    leadTypes: new Set(),
    noDealOnly: false,
  };
  const listeners = [];

  function notify() { for (const fn of listeners) fn(state); }
  function onChange(fn) { listeners.push(fn); }

  function setDefault(leads) {
    if (state.from || state.to) return; // user already set something
    const dates = leads.map(l => l.datestamp_d).filter(Boolean).sort((a, b) => a - b);
    if (dates.length) {
      const max = dates[dates.length - 1];
      const ninety = new Date(max); ninety.setDate(max.getDate() - 90);
      state.from = ninety;
      state.to = max;
    }
  }

  function populateOptions(leads) {
    const fillSelect = (id, vals) => {
      const sel = document.getElementById(id);
      sel.innerHTML = "";
      for (const v of vals) {
        const opt = document.createElement("option");
        opt.value = v; opt.textContent = v;
        sel.appendChild(opt);
      }
    };
    const uniq = (key) => Array.from(new Set(
      leads.map(l => l[key]).filter(v => v && String(v).trim())
    )).sort();
    fillSelect("f-division", uniq("division"));
    fillSelect("f-source",   uniq("source"));
    fillSelect("f-leadtype", uniq("is_lead"));
  }

  function wireSidebar() {
    const $from = document.getElementById("f-from");
    const $to = document.getElementById("f-to");
    const $div = document.getElementById("f-division");
    const $src = document.getElementById("f-source");
    const $type = document.getElementById("f-leadtype");
    const $nodeal = document.getElementById("f-nodeal");
    const $reset = document.getElementById("f-reset");

    const fmt = (d) => d ? d.toISOString().slice(0, 10) : "";
    $from.value = fmt(state.from);
    $to.value = fmt(state.to);

    $from.addEventListener("change", () => { state.from = $from.value ? new Date($from.value) : null; notify(); });
    $to.addEventListener("change", () => {
      if ($to.value) {
        const d = new Date($to.value); d.setHours(23, 59, 59, 999);
        state.to = d;
      } else state.to = null;
      notify();
    });
    const wireMulti = (sel, target) => {
      sel.addEventListener("change", () => {
        target.clear();
        for (const opt of sel.selectedOptions) target.add(opt.value);
        notify();
      });
    };
    wireMulti($div, state.divisions);
    wireMulti($src, state.sources);
    wireMulti($type, state.leadTypes);
    $nodeal.addEventListener("change", () => { state.noDealOnly = $nodeal.checked; notify(); });
    $reset.addEventListener("click", () => {
      state.divisions.clear(); state.sources.clear(); state.leadTypes.clear();
      state.noDealOnly = false;
      [$div, $src, $type].forEach(s => { for (const o of s.options) o.selected = false; });
      $nodeal.checked = false;
      notify();
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
      return true;
    });
  }

  return { state, onChange, setDefault, populateOptions, wireSidebar, apply };
})();
