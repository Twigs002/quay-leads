// Action Tracker — filterable list of leads with editable notes.
// "Worked" is derived from HubSpot (read-only). This page is for notes.
// Notes autosave on blur / Enter — no per-row Save button, no page reload.
window.VIEWS = window.VIEWS || {};
window.VIEWS["action-tracker"] = function (root, ctx) {
  const all = ctx.view.leads;
  const { escapeHtml, escapeAttr, fmtDate } = UTILS;
  let showAll = false;

  function visible() {
    let work = showAll ? all : all.filter(l => !l.worked);
    work = work.filter(l => l.email);
    return work;
  }

  function render() {
    const work = visible();
    const worked = work.filter(l => l.worked).length;
    const outstanding = work.length - worked;

    if (!all.length) {
      root.innerHTML = `<h2>Action Tracker</h2>${UTILS.emptyState()}`;
      return;
    }

    root.innerHTML = `
      <h2>Action Tracker</h2>
      <p class="lede">
        <strong>Worked</strong> comes from HubSpot — a deal with a logged call.
        This page is for adding <strong>notes</strong> against leads (saves to Supabase).
        The source sheet is never edited.
      </p>

      <label class="row" style="display:inline-flex; align-items:center; gap:8px; margin-bottom: 12px;">
        <input type="checkbox" id="show-all" ${showAll ? "checked" : ""}>
        <span>Show all leads (including ones already worked)</span>
      </label>

      <p><strong>${work.length.toLocaleString()}</strong> leads · <strong>${worked.toLocaleString()}</strong> already worked · <strong>${outstanding.toLocaleString()}</strong> outstanding</p>

      <p class="muted small">Notes save automatically when you leave the field or press Enter.</p>

      <div class="table-wrap">
        <table class="dt">
          <thead><tr>
            <th>Date</th>
            <th>Client</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Suburb</th>
            <th>Division</th>
            <th>Source</th>
            <th>Lead type</th>
            <th>HubSpot stage</th>
            <th class="num">Calls</th>
            <th>Worked</th>
            <th>Note</th>
          </tr></thead>
          <tbody>${work.slice(0, 500).map(row).join("")}</tbody>
        </table>
      </div>
      ${work.length > 500 ? `<p class="muted small" style="margin-top:8px;">Showing first 500 of ${work.length.toLocaleString()}. Refine filters to narrow.</p>` : ""}

      <h3 style="margin-top: 24px;">Recent notes</h3>
      <div id="recent-notes"></div>
    `;

    document.getElementById("show-all").addEventListener("change", e => {
      showAll = e.target.checked;
      render();
    });

    // Autosave on blur or Enter — no Save button needed.
    root.querySelectorAll("input.note-input").forEach(input => {
      const original = input.value;
      const save = async () => {
        const text = (input.value || "").trim();
        if (text === (original || "").trim()) return; // unchanged
        input.classList.add("saving");
        try {
          await DATA.addNote(input.dataset.email, text, ctx.user.username);
          input.classList.remove("saving");
          input.classList.add("saved");
          // Mutate the in-memory cache so the row reflects the new note
          // without a page reload.
          const lead = ctx.cache.leads.find(l => (l.email || "").toLowerCase() === input.dataset.email.toLowerCase());
          if (lead) {
            lead.action_note = text;
            lead.note_at = new Date().toISOString();
            lead.note_by = ctx.user.username;
          }
          setTimeout(() => input.classList.remove("saved"), 1500);
          renderRecent();
        } catch (e) {
          input.classList.remove("saving");
          input.classList.add("error");
          input.title = "Failed to save: " + (e.message || e);
        }
      };
      input.addEventListener("blur", save);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { input.value = original; input.blur(); }
      });
    });

    renderRecent();
  }

  function renderRecent() {
    const recent = ctx.cache.leads
      .filter(l => l.note_at)
      .sort((a, b) => (b.note_at || "").localeCompare(a.note_at || ""))
      .slice(0, 30);
    const el = document.getElementById("recent-notes");
    if (!el) return;
    el.innerHTML = recent.length === 0
      ? '<p class="muted">No notes yet.</p>'
      : `<div class="table-wrap"><table class="dt">
          <thead><tr><th>When</th><th>Who</th><th>Lead</th><th>Note</th></tr></thead>
          <tbody>${recent.map(l => `<tr>
            <td>${fmtDate(l.note_at)}</td>
            <td>${escapeHtml(l.note_by || "")}</td>
            <td>${escapeHtml(l.client_name || l.email)}</td>
            <td>${escapeHtml(l.action_note || "")}</td>
          </tr>`).join("")}</tbody></table></div>`;
  }

  function row(l) {
    return `<tr>
      <td>${fmtDate(l.datestamp)}</td>
      <td>${escapeHtml(l.client_name || "")}</td>
      <td>${escapeHtml(l.email || "")}</td>
      <td>${escapeHtml(l.phone || "")}</td>
      <td>${escapeHtml(l.suburb || "")}</td>
      <td>${escapeHtml(l.division || "")}</td>
      <td>${escapeHtml(l.source || "")}</td>
      <td>${escapeHtml(l.is_lead || "")}</td>
      <td>${escapeHtml(l.current_stage || "")}</td>
      <td class="num">${l.num_calls || 0}</td>
      <td>${l.worked ? '<span class="pill green">Worked</span>' : ''}</td>
      <td><input class="note-input" type="text" placeholder="add note, Enter to save…" data-email="${escapeAttr(l.email)}" value="${escapeAttr(l.action_note || "")}"></td>
    </tr>`;
  }

  render();
};
