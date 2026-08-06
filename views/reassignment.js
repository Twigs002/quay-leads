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

  Promise.all([DATA.loadReassignment(), DATA.loadReassignmentCandidates()])
    .then(([{ ready, teams, log }, cand]) => {
      if (!ready) {
        root.innerHTML = `<h2>Reassignment</h2>
          <div class="card" style="padding:20px;">
            <p><strong>Not set up yet.</strong> Run the migration
            <code>supabase/migrations/2026-07-31_reassignment.sql</code> in the
            Supabase SQL editor, then reload this page.</p>
          </div>`;
        return;
      }
      render(teams, log, (cand && cand.deals) || []);
    }).catch(e => {
      root.innerHTML = `<h2>Reassignment</h2>
        <div class="error-box">Could not load reassignment settings: ${escapeHtml(e.message || String(e))}</div>`;
    });

  // Build a candidate list from raw deal rows + the roster. A candidate is a
  // deal whose current owner maps to a participating, can_originate team.
  // days = whole days since the 72h clock origin (max of createdate + last
  // reassignment); null when neither date is known yet (pre-backfill).
  // Stable per-deal hash → an index, so the shown target is deterministic and
  // matches what the Apply button sends (no random reshuffle on re-render).
  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  // Mirror of the evaluator's target rule: a random OTHER team in the same
  // open-border group that can_receive, is active, has an owner id, isn't the
  // current owner, and hasn't already held this deal. Returns a team row or null.
  function pickTarget(groupTeams, fromOwner, visited, dealId) {
    const pool = (groupTeams || []).filter(t =>
      t.can_receive && t.active &&
      String(t.hubspot_owner_id || "").trim() &&
      String(t.hubspot_owner_id) !== String(fromOwner) &&
      !visited.has(String(t.hubspot_owner_id))
    ).sort((a, b) => (a.team || "").localeCompare(b.team || ""));
    if (!pool.length) return null;
    return pool[hashStr(String(dealId)) % pool.length];
  }

  function buildCandidates(deals, teams) {
    const byOwner = new Map();
    const byGroup = new Map();
    for (const t of teams) {
      if (t.hubspot_owner_id) byOwner.set(String(t.hubspot_owner_id), t);
      if (!byGroup.has(t.open_border_group)) byGroup.set(t.open_border_group, []);
      byGroup.get(t.open_border_group).push(t);
    }
    const now = Date.now();
    const out = [];
    for (const d of deals) {
      const fromOwner = String(d.hubspot_owner_id || "");
      const team = byOwner.get(fromOwner);
      if (!team || !team.can_originate || !team.active) continue;
      const origin = [d.last_reassigned_at, d.hs_createdate]
        .map(s => (s ? new Date(s).getTime() : NaN))
        .filter(n => !isNaN(n));
      const clock = origin.length ? Math.max(...origin) : null;
      const days = clock != null ? Math.floor((now - clock) / 86400000) : null;
      const visited = new Set((d.reassign_visited || []).map(x => String(x)));
      visited.add(fromOwner);
      const target = team.open_border_group
        ? pickTarget(byGroup.get(team.open_border_group), fromOwner, visited, d.deal_id)
        : null;
      out.push({
        deal_id: d.deal_id,
        deal_name: d.deal_name || d.deal_id,
        stage: d.current_stage,
        team: team.team,
        from_owner: fromOwner,
        group: team.open_border_group,
        hops: d.reassign_hops || 0,
        days,
        to_team: target ? target.team : null,
        to_owner: target ? String(target.hubspot_owner_id) : null,
      });
    }
    // Stalest first; unknown-age rows sink to the bottom.
    out.sort((a, b) => (b.days == null ? -1 : b.days) - (a.days == null ? -1 : a.days));
    return out;
  }

  function render(teams, log, candidateDeals) {
    const candidates = buildCandidates(candidateDeals, teams);
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
        <strong>Manual moves are live.</strong> Each candidate below shows the team it would move to and a
        <strong>Reassign</strong> button. Pushing it moves that one deal in HubSpot right away (deal owner
        plus every associated contact) and logs it below. The automatic daily evaluator stays in
        <strong>dry-run</strong> until you set the repo variable <code>REASSIGN_ARM=1</code>, so nothing
        moves on its own.
      </div>

      ${renderCandidates(candidates)}

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
    wireApplyButtons();
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

  // Live preview of deals that currently match stage + 0 calls, grouped
  // under one card. The 72h rule = 3 whole days idle; rows at/over that are
  // flagged "would move". Days come from hs_createdate (backfilled by sync);
  // until that lands some rows show "pending".
  function renderCandidates(candidates) {
    const total = candidates.length;
    const past72 = candidates.filter(c => c.days != null && c.days >= 3).length;
    const pending = candidates.filter(c => c.days == null).length;

    if (!total) {
      return `<div class="card" style="padding:20px; margin-bottom:16px;">
        <h3 style="margin:0 0 8px;">Candidate deals</h3>
        <p class="muted">No deals currently match a qualifying stage with zero calls under a participating team.</p>
      </div>`;
    }

    const daysCell = c => {
      if (c.days == null) return `<span class="muted small">pending sync</span>`;
      const eligible = c.days >= 3;
      const label = c.days === 0 ? "today" : `${c.days}d`;
      return eligible
        ? `<strong style="color:#C0392B;">${label}</strong>`
        : `<span>${label}</span>`;
    };

    const targetCell = c => c.to_team
      ? `<strong>${escapeHtml(c.to_team)}</strong>`
      : `<span class="muted small">no eligible team in ${escapeHtml(c.group || "area")}</span>`;

    const actionCell = c => c.to_team
      ? `<button class="btn-apply" data-deal="${escapeAttr(c.deal_id)}"
           data-to-owner="${escapeAttr(c.to_owner)}"
           data-from="${escapeAttr(c.team)}" data-to="${escapeAttr(c.to_team)}"
           data-name="${escapeAttr(c.deal_name)}">Reassign →</button>`
      : `<button class="btn-apply" disabled title="No eligible receiving team">Reassign →</button>`;

    return `<div class="card" style="padding:20px; margin-bottom:16px;">
      <h3 style="margin:0 0 4px;">Candidate deals
        <span class="muted small" style="font-weight:400;">· ${total} in a qualifying stage with 0 calls</span></h3>
      <p class="muted small" style="margin:0 0 12px;">
        Stages: External Lead, Calling Lead, Inbound Lead. <strong>${past72}</strong> already past the
        <strong>72h</strong> (3-day) idle mark${pending ? ` · ${pending} awaiting create-date backfill (next sync)` : ""}.
        <strong>Moves to</strong> is the team a deal would go to. Push <strong>Reassign</strong> to move it
        now in HubSpot (deal owner + every associated contact). This is immediate and real.
      </p>
      <div class="table-wrap"><table class="dt">
        <thead><tr>
          <th>Deal</th><th>Current team</th><th>Moves to</th><th>Area</th><th>Stage</th>
          <th class="num">Days idle</th><th class="num">Hops</th><th>Action</th>
        </tr></thead>
        <tbody>${candidates.map(c => `<tr data-row="${escapeAttr(c.deal_id)}">
          <td>${escapeHtml(c.deal_name)}</td>
          <td><strong>${escapeHtml(c.team)}</strong></td>
          <td>${targetCell(c)}</td>
          <td>${escapeHtml(c.group)}</td>
          <td>${escapeHtml(c.stage)}</td>
          <td class="num">${daysCell(c)}</td>
          <td class="num">${c.hops || ""}</td>
          <td>${actionCell(c)}</td>
        </tr>`).join("")}</tbody>
      </table></div>
    </div>`;
  }

  function wireApplyButtons() {
    root.querySelectorAll("button.btn-apply[data-deal]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { deal, toOwner, from, to, name } = btn.dataset;
        if (!confirm(`Reassign "${name}" from ${from} to ${to}?\n\nThis moves the deal owner and every associated contact in HubSpot immediately.`)) return;
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Moving…";
        try {
          const res = await DATA.applyReassignment(deal, toOwner);
          const row = root.querySelector(`tr[data-row="${CSS.escape(deal)}"]`);
          if (row) {
            row.style.opacity = "0.55";
            const actionTd = row.lastElementChild;
            if (actionTd) actionTd.innerHTML = `<span class="pill green">moved${res.contacts_patched ? ` · ${res.contacts_patched} contacts` : ""}</span>`;
          }
        } catch (e) {
          btn.disabled = false;
          btn.textContent = original;
          btn.title = "Failed: " + (e.message || e);
          alert("Reassignment failed: " + (e.message || e));
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
