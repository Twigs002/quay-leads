// Global filter state + sidebar wiring.
// Multi-selects use <details> for the disclosure pattern with live
// checkboxes inside — mirrors Streamlit's st.multiselect UX.
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
    if (state.from || state.to) return;
    const dates = leads.map(l => l.datestamp_d).filter(Boolean).sort((a, b) => a - b);
    if (dates.length) {
      const max = dates[dates.length - 1];
      const ninety = new Date(max); ninety.setDate(max.getDate() - 90);
      state.from = ninety;
      state.to = max;
    }
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

  function wireSidebar() {
    const $from = document.getElementById("f-from");
    const $to = document.getElementById("f-to");
    const $nodeal = document.getElementById("f-nodeal");
    const $reset = document.getElementById("f-reset");

    const fmt = (d) => d ? d.toISOString().slice(0, 10) : "";
    $from.value = fmt(state.from);
    $to.value = fmt(state.to);

    $from.addEventListener("change", () => {
      state.from = $from.value ? new Date($from.value) : null;
      notify();
    });
    $to.addEventListener("change", () => {
      if ($to.value) {
        const d = new Date($to.value); d.setHours(23, 59, 59, 999);
        state.to = d;
      } else state.to = null;
      notify();
    });
    $nodeal.addEventListener("change", () => {
      state.noDealOnly = $nodeal.checked; notify();
    });
    $reset.addEventListener("click", () => {
      state.divisions.clear(); state.sources.clear(); state.leadTypes.clear();
      state.noDealOnly = false;
      $nodeal.checked = false;
      document.querySelectorAll(".multi-list input[type=checkbox]")
        .forEach(cb => cb.checked = false);
      ["ms-division", "ms-source", "ms-leadtype"].forEach(id => {
        const $sum = document.querySelector(`#${id} summary .summary-value`);
        if ($sum) { $sum.textContent = "All"; $sum.classList.remove("selected"); }
      });
      notify();
    });

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
      return true;
    });
  }

  return { state, onChange, setDefault, populateOptions, wireSidebar, apply };
})();
