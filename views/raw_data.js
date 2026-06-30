// Raw Data — searchable / filterable table + CSV export.
window.VIEWS = window.VIEWS || {};
window.VIEWS["raw-data"] = function (root, ctx) {
  const all = ctx.view.leads;
  let q = "";

  function render() {
    const work = filtered();
    root.innerHTML = `
      <h2>Raw Data</h2>
      <p class="lede">Full row-level access. Sidebar filters apply. Search box filters by client/email/suburb/address/division/source.</p>

      <input class="search" id="raw-search" type="text" placeholder="search…" value="${escapeAttr(q)}">
      <p class="muted small">${work.length.toLocaleString()} rows · <button id="csv-btn" class="btn-ghost" style="padding: 4px 12px;">⬇ Download CSV</button></p>

      <div class="table-wrap" style="max-height: 65vh; overflow:auto;">
        <table class="dt">
          <thead><tr>
            <th>Date</th>
            <th>Source</th>
            <th>Client</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Address</th>
            <th>Suburb</th>
            <th>Property</th>
            <th>Division</th>
            <th>Lead type</th>
            <th>Status</th>
            <th>Deal ID</th>
            <th>HubSpot stage</th>
            <th class="num">Calls</th>
            <th>Worked</th>
            <th class="num">Deal R</th>
            <th>Expected close</th>
            <th>Last touched</th>
          </tr></thead>
          <tbody>${work.slice(0, 1000).map(rowHtml).join("")}</tbody>
        </table>
      </div>
      ${work.length > 1000 ? `<p class="muted small">Showing first 1,000 of ${work.length.toLocaleString()}. Refine filters to narrow, or export to CSV for full set.</p>` : ""}
    `;

    document.getElementById("raw-search").addEventListener("input", e => {
      q = e.target.value.toLowerCase();
      render();
    });
    document.getElementById("csv-btn").addEventListener("click", () => downloadCSV(work));
  }

  function filtered() {
    if (!q) return all;
    return all.filter(l => {
      const blob = [l.client_name, l.email, l.phone, l.property_address, l.suburb, l.division, l.source, l.is_lead]
        .map(v => String(v || "").toLowerCase()).join(" ");
      return blob.includes(q);
    });
  }

  function rowHtml(l) {
    return `<tr>
      <td>${fmtDate(l.datestamp)}</td>
      <td>${escapeHtml(l.source || "")}</td>
      <td>${escapeHtml(l.client_name || "")}</td>
      <td>${escapeHtml(l.email || "")}</td>
      <td>${escapeHtml(l.phone || "")}</td>
      <td>${escapeHtml(l.property_address || "")}</td>
      <td>${escapeHtml(l.suburb || "")}</td>
      <td>${escapeHtml(l.property_type || "")}</td>
      <td>${escapeHtml(l.division || "")}</td>
      <td>${escapeHtml(l.is_lead || "")}</td>
      <td>${l.has_deal ? '<span class="pill green">Has Deal</span>' : '<span class="pill amber">Retry</span>'}</td>
      <td>${escapeHtml(l.deal_id || "")}</td>
      <td>${escapeHtml(l.current_stage || "")}</td>
      <td class="num">${l.num_calls || 0}</td>
      <td>${l.worked ? "✅" : ""}</td>
      <td class="num">${l.amount ? "R" + Number(l.amount).toLocaleString(undefined, { maximumFractionDigits: 0 }) : ""}</td>
      <td>${fmtShortDate(l.close_date)}</td>
      <td>${fmtShortDate(l.hs_last_modified)}</td>
    </tr>`;
  }

  function downloadCSV(rows) {
    const cols = ["datestamp", "source", "client_name", "email", "phone", "property_address",
      "suburb", "property_type", "division", "is_lead", "action_flag", "deal_id",
      "current_stage", "num_calls", "worked", "amount", "close_date", "hs_last_modified"];
    const header = cols.join(",");
    const body = rows.map(r => cols.map(c => csvCell(r[c])).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "quay_leads_export.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  render();
};

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d) ? "" : d.toISOString().slice(0, 16).replace("T", " ");
}
function fmtShortDate(s) {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }
