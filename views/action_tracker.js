// Action Tracker — filterable list of leads with editable notes.
// "Worked" is derived from HubSpot (read-only). This page is for notes.
window.VIEWS = window.VIEWS || {};
window.VIEWS["action-tracker"] = function (root, ctx) {
  const all = ctx.view.leads;
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
            <th></th>
          </tr></thead>
          <tbody>${work.slice(0, 500).map(l => row(l)).join("")}</tbody>
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

    root.querySelectorAll(".note-save").forEach(btn => {
      btn.addEventListener("click", async () => {
        const email = btn.dataset.email;
        const input = root.querySelector(`input.note-input[data-email="${cssEscape(email)}"]`);
        const text = (input.value || "").trim();
        if (!text) return;
        btn.disabled = true;
        btn.textContent = "Saving…";
        try {
          await DATA.addNote(email, text, ctx.user.username);
          btn.textContent = "Saved ✓";
          input.value = "";
          // refresh cache then re-render via hashchange trick
          DATA.invalidate();
          setTimeout(() => location.reload(), 700);
        } catch (e) {
          btn.disabled = false;
          btn.textContent = "Save";
          alert("Failed to save: " + (e.message || e));
        }
      });
    });

    renderRecent();
  }

  async function renderRecent() {
    const recent = ctx.cache.leads
      .filter(l => l.note_at)
      .sort((a, b) => (b.note_at || "").localeCompare(a.note_at || ""))
      .slice(0, 30);
    document.getElementById("recent-notes").innerHTML = recent.length === 0
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
      <td>${l.worked ? "✅" : ""}</td>
      <td><input class="note-input" type="text" placeholder="add note…" data-email="${escapeAttr(l.email)}" value="${escapeAttr(l.action_note || "")}" style="width: 220px; padding: 4px 8px; font-family: var(--sans); border: 1px solid var(--line); border-radius: 6px;"></td>
      <td><button class="btn-ghost note-save" data-email="${escapeAttr(l.email)}" style="padding: 4px 10px;">Save</button></td>
    </tr>`;
  }

  render();
};

function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d) ? "" : d.toISOString().slice(0, 16).replace("T", " ");
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }
function cssEscape(s) { return String(s).replace(/(["\\])/g, "\\$1"); }
