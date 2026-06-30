// Bootstrap: auth → load → wire filters → router.
(async function () {
  const $login = document.getElementById("login");
  const $app = document.getElementById("app");
  const $loginForm = document.getElementById("login-form");
  const $loginError = document.getElementById("login-error");
  const $userLabel = document.getElementById("user-label");
  const $signout = document.getElementById("signout");
  const $view = document.getElementById("view");
  const $syncStatus = document.getElementById("sync-status");

  function showLogin() {
    $login.classList.remove("hidden");
    $app.classList.add("hidden");
  }
  function showApp(user) {
    $login.classList.add("hidden");
    $app.classList.remove("hidden");
    $userLabel.textContent = `${user.name}${user.isSuper ? " · super" : user.isAdmin ? " · admin" : ""}`;
  }

  function showError(msg) {
    $loginError.textContent = msg;
    $loginError.hidden = false;
  }

  $loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    $loginError.hidden = true;
    const username = document.getElementById("login-user").value;
    const pin = document.getElementById("login-pin").value;
    const r = await DATA.signIn(username, pin);
    if (!r.ok) { showError(r.error); return; }
    await boot(r.user);
  });

  $signout.addEventListener("click", async () => {
    await DATA.signOut();
    location.reload();
  });

  async function boot(user) {
    showApp(user);
    $view.innerHTML = '<div class="loading">Loading data…</div>';

    let cache;
    try {
      cache = await DATA.loadAll();
    } catch (e) {
      $view.innerHTML = `<div class="error-box">Could not load data: ${escapeHtml(e.message || String(e))}</div>`;
      return;
    }

    // Sync status pill
    if (cache.lastSync) {
      const ago = humanAgo(new Date(cache.lastSync));
      $syncStatus.innerHTML = `Last sync: <strong>${ago}</strong>` + (cache.syncOk === false ? ` <span class="pill red">error</span>` : "");
    } else {
      $syncStatus.textContent = "Awaiting first sync…";
    }

    // Filters
    FILTERS.setDefault(cache.leads);
    FILTERS.populateOptions(cache.leads);
    FILTERS.wireSidebar();
    FILTERS.onChange(() => router(user, cache));

    // Refresh / reload buttons
    wireRefresh();

    // Router
    window.addEventListener("hashchange", () => router(user, cache));
    router(user, cache);
  }

  function wireRefresh() {
    const $refresh = document.getElementById("refresh-now");
    const $reload = document.getElementById("reload-data");
    if (!$refresh || !$reload) return;

    $refresh.addEventListener("click", async () => {
      $refresh.disabled = true;
      const originalLabel = $refresh.textContent;
      $refresh.textContent = "↻ Queuing…";
      try {
        const res = await DATA.triggerSync();
        toast({
          title: "Sync queued ✓",
          body: `Triggered by <strong>${escapeHtml(res.triggered_by_name || res.triggered_by || "you")}</strong>. ` +
                `New data will land in ~90 sec — page will auto-reload then. ` +
                `<a href="${res.run_url}" target="_blank" rel="noopener">Watch on GitHub →</a>`,
          ms: 10000,
        });
        $refresh.textContent = "↻ Syncing… 90s";
        setTimeout(() => location.reload(), 105000);
      } catch (e) {
        const msg = (e && e.message) || String(e);
        // Fallback: if the Edge Function isn't deployed yet, open GH directly.
        if (msg.includes("404") || msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("failed to fetch")) {
          window.open("https://github.com/Twigs002/quay-leads/actions/workflows/sync.yml", "_blank", "noopener");
          toast({
            title: "Edge Function not deployed",
            body: "Opened GitHub Actions in a new tab — click <strong>Run workflow</strong> to start a sync. (Deploy the trigger-sync function for one-click sync.)",
            ms: 8000,
          });
          $refresh.textContent = originalLabel;
          $refresh.disabled = false;
          return;
        }
        toast({ title: "Could not trigger sync", body: escapeHtml(msg), ms: 6000 });
        $refresh.textContent = originalLabel;
        $refresh.disabled = false;
      }
    });

    $reload.addEventListener("click", async () => {
      $reload.disabled = true;
      $reload.textContent = "⟳ Loading…";
      DATA.invalidate();
      try {
        await DATA.loadAll(true);
        location.reload();
      } catch (e) {
        toast({ title: "Reload failed", body: escapeHtml(e.message || String(e)), ms: 6000 });
        $reload.disabled = false;
        $reload.textContent = "⟳ Reload";
      }
    });
  }

  function toast({ title, body, ms = 5000 }) {
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `<div class="toast-title">${title}</div><div>${body}</div>`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 300);
    }, ms);
  }

  function router(user, cache) {
    const hash = location.hash || "#/overview";
    const tab = hash.replace(/^#\//, "");
    document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === tab));
    const view = filteredView(cache);
    const ctx = { user, cache, view };
    const handler = VIEWS[tab] || VIEWS["overview"];
    try {
      handler($view, ctx);
    } catch (e) {
      console.error(e);
      $view.innerHTML = `<div class="error-box">Render error: ${escapeHtml(e.message || String(e))}</div>`;
    }
  }

  function filteredView(cache) {
    return { ...cache, leads: FILTERS.apply(cache.leads) };
  }

  function humanAgo(date) {
    const s = (Date.now() - date.getTime()) / 1000;
    if (s < 60) return `${Math.floor(s)}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Try session restore on load
  const existing = await DATA.getSession();
  if (existing) await boot(existing);
  else showLogin();
})();
