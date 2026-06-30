// Shared utilities — used across views.
window.UTILS = (() => {
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  function trunc(s, n) {
    return s && s.length > n ? s.slice(0, n - 1) + "…" : s;
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

  function humanAgo(date) {
    const s = (Date.now() - date.getTime()) / 1000;
    if (s < 60) return `${Math.floor(s)}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  }

  function pct(n, d) { return d ? `${(n / d * 100).toFixed(1)}%` : "—"; }

  // Empty-state HTML when filters return zero rows
  function emptyState(message = "No leads match the current filters.") {
    return `<div class="empty-state">
      <div class="empty-state-icon">∅</div>
      <p>${escapeHtml(message)}</p>
      <button class="btn-ghost" onclick="document.getElementById('f-reset').click()">Reset filters</button>
    </div>`;
  }

  return { escapeHtml, escapeAttr, trunc, fmtDate, fmtShortDate, humanAgo, pct, emptyState };
})();
