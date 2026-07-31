// Reassignment — open-border stale-lead reassignment control + audit.
// Super/admin only. Two sections:
//   1. Team roster — per-team can_originate / can_receive / active toggles,
//      grouped by open-border area (WSB / NS / SP / SW).
//   2. Audit log — every reassignment decision (applied or dry-run).
// The evaluator that fills the audit log is wired once the qualifying
// stage names are confirmed; until then this page manages config and shows
// an empty log. Loads its own data (not part of the shared cache).
window.VIEWS = window.VIEWS || {};

const GROUP_LABELS = {
  WSB: "Western Seaboard (WSB)",
  NS:  "Northern Suburbs (NS)",
  SP:  "South Peninsula (SP)",
  SW:  "Somerset West (SW)",
};

window.VIEWS["reassignment"] = function (root, ctx) {
  const { escapeHtml, escapeAttr } = UTILS;
  const fmtDate = UTILS.fmtDate || (s => s || "");

  // Gate: super/admin only. Everyone else gets a polite wall.
  if (!(ctx.user && (ctx.user.isSuper || ctx.user.isAdmin))) {
    root.innerHTML = `<h2>Reassignment</h2>
      <div class="card" style="padding:20px;"><p class="muted">This page is restricted to super and admin users.</p></div>`;
    return;
  }

  root.innerHTML = `<h2>Reassignment</h2><div class="loading">Loading reassignment settings…</div>`;

  DATA.loadReassignment().then(({ ready, teams, log }) => {
    if (!ready) {
      root.innerHTML = `<h2>Reassignment</h2>
        <div class="card" style="padding:20px;">
          <p><strong>Not set up yet.</strong> Run the migration
          <code>supabase/migrations/2026-07-31_reassignment.sql</code> in the
          Supabase SQL editor, then reload this page.</p>
        </div>`;
      return;
    }
    render(teams, log);
  }).catch(e => {
    root.innerHTML = `<h2>Reassignment</h2>
      <div class="error-box">Could not load reassignment settings: ${escapeHtml(e.message || String(e))}</div>`;
  });

  function render(teams, log) {
    // Group teams by open-border area, in a stable order.
    const order = ["WSB", "NS", "SP", "SW"];
    const byGroup = new Map();
    for (const t of teams) {
      if (!byGroup.has(t.open_border_group)) byGroup.set(t.open_border_group, []);
      byGroup.get(t.open_border_group).push(t);
    }
    const groups = [...byGroup.keys()].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    root.innerHTML = `
      <h2>Reassignment</h2>
      <p class="lede">
        A deal that enters a qualifying stage and gets <strong>no calls for 72 hours</strong>
        (clock from deal creation, and reset on each move) is reassigned to a
        <strong>random other team in the same open-border area</strong>. Both the
        <strong>deal owner</strong> and every <strong>associated contact's owner</strong>
        are updated in HubSpot. Only teams below take part; areas outside these groups are untouched.
      </p>

      <div class="card" style="padding:14px 18px; margin-bottom:16px; border-left:4px solid #FDC503;">
        <strong>Evaluator not armed yet.</strong> The trigger runs once the qualifying stage
        names are confirmed. Toggles below are live and take effect the moment it goes on
        (first runs will be dry-run only).
      </div>

      <div class="card" style="padding:20px; margin-bottom:16px;">
        <h3 style="margin:0 0 4px;">Team roster</h3>
        <p class="muted small" style="margin:0 0 12px;">
          <strong>Originate</strong> = may lose a stale lead. <strong>Receive</strong> = may be
          given one. <strong>Active</strong> = participates at all. Teams with no HubSpot owner id
          can never receive.
        </p>
        ${groups.map(g => renderGroup(g, byGroup.get(g))).join("")}
      </div>

      <div class="card" style="padding:20px;">
        <h3 style="margin:0 0 12px;">Reassignment log</h3>
        ${renderLog(log)}
      </div>
    `;

    wireToggles();
  }

  function renderGroup(group, rows) {
    rows = rows.slice().sort((a, b) => (a.team || "").localeCompare(b.team || ""));
    return `
      <h4 style="margin:18px 0 8px;">${escapeHtml(GROUP_LABELS[group] || group)}
        <span class="muted small" style="font-weight:400;">· ${rows.length} teams</span></h4>
      <div class="table-wrap">
        <table class="dt">
          <thead><tr>
            <th>Team</th><th>HubSpot owner id</th>
            <th style="text-align:center;">Originate</th>
            <th style="text-align:center;">Receive</th>
            <th style="text-align:center;">Active</th>
          </tr></thead>
          <tbody>${rows.map(rowFor).join("")}</tbody>
        </table>
      </div>`;
  }

  function rowFor(t) {
    const noOwner = !t.hubspot_owner_id;
    const owner = noOwner
      ? '<span class="muted small">no owner id · never receives</span>'
      : `<code>${escapeHtml(t.hubspot_owner_id)}</code>`;
    // Receive is forced off + disabled when there's no owner id.
    return `<tr>
      <td><strong>${escapeHtml(t.team)}</strong></td>
      <td>${owner}</td>
      <td style="text-align:center;">${sw(t, "can_originate")}</td>
      <td style="text-align:center;">${noOwner ? swDisabled(false) : sw(t, "can_receive")}</td>
      <td style="text-align:center;">${sw(t, "active")}</td>
    </tr>`;
  }

  function sw(t, field) {
    const on = !!t[field];
    return `<label class="switch">
      <input type="checkbox" ${on ? "checked" : ""}
        data-team="${escapeAttr(t.team)}" data-field="${field}">
      <span class="switch-track"></span>
    </label>`;
  }

  function swDisabled(on) {
    return `<label class="switch">
      <input type="checkbox" ${on ? "checked" : ""} disabled>
      <span class="switch-track"></span>
    </label>`;
  }

  function wireToggles() {
    root.querySelectorAll(".switch input[data-team]").forEach(input => {
      input.addEventListener("change", async () => {
        const team = input.dataset.team, field = input.dataset.field;
        const value = input.checked;
        input.disabled = true;
        try {
          await DATA.setTeamToggle(team, field, value);
        } catch (e) {
          input.checked = !value; // revert
          input.title = "Failed to save: " + (e.message || e);
          const el = input.closest(".switch");
          if (el) { el.classList.add("save-error"); setTimeout(() => el.classList.remove("save-error"), 2000); }
        } finally {
          input.disabled = false;
        }
      });
    });
  }

  function renderLog(log) {
    if (!log.length) {
      return `<p class="muted">No reassignments logged yet. They appear here once the evaluator is armed.</p>`;
    }
    const badge = r => r.dry_run
      ? '<span class="pill" style="background:#E7ECF6;color:#1A2746;">dry-run</span>'
      : (r.status === "error"
        ? '<span class="pill red">error</span>'
        : '<span class="pill green">applied</span>');
    return `<div class="table-wrap"><table class="dt">
      <thead><tr>
        <th>When</th><th>Area</th><th>Deal</th>
        <th>From</th><th>To</th>
        <th class="num">Hop</th><th class="num">Contacts</th><th>Status</th>
      </tr></thead>
      <tbody>${log.map(r => `<tr>
        <td>${fmtDate(r.evaluated_at)}</td>
        <td>${escapeHtml(r.open_border_group || "")}</td>
        <td>${escapeHtml(r.deal_name || r.deal_id || "")}</td>
        <td>${escapeHtml(r.from_team || r.from_owner_id || "")}</td>
        <td>${escapeHtml(r.to_team || r.to_owner_id || "")}</td>
        <td class="num">${r.hop != null ? r.hop : ""}</td>
        <td class="num">${r.contacts_patched != null ? r.contacts_patched : ""}</td>
        <td>${badge(r)}${r.error ? ` <span class="muted small" title="${escapeAttr(r.error)}">⚠</span>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;
  }
};
