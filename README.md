# Quay 1 — Seller Leads (GitHub Pages edition)

Static dashboard for the Quay 1 Realty seller-lead pipeline. Hosted on
GitHub Pages. PIN-gated via the same Supabase auth that powers
`quay-clock` and `quay-leads-dashboard` (the Streamlit version).

```
┌──────────────────────────────────────────────────────────┐
│  Twigs002/quay-leads  →  twigs002.github.io/quay-leads/  │
└──────────────────────────────────────────────────────────┘
                          ▲
                          │  static HTML/CSS/JS
                          │
┌──────────────────────────────────────────────────────────┐
│  Browser                                                  │
│   • Sign in (Supabase Auth, PIN)                          │
│   • Read leads / deal state from Supabase (RLS)           │
│   • Render charts (Chart.js), filters, tables (DataTables)│
│   • Write notes to Supabase (RLS-gated)                   │
└──────────────────────────────────────────────────────────┘
                          ▲
                          │  HTTPS + JWT
                          │
┌──────────────────────────────────────────────────────────┐
│  Supabase (dqszbqiimbfvmmnpgpsb)                          │
│   tables:                                                  │
│     staff           ← from quay-clock                     │
│     leads           ← synced every 30 min by GitHub Action│
│     hs_deal_state   ← synced every 30 min                 │
│     lead_actions    ← notes (RLS to super/admin)          │
└──────────────────────────────────────────────────────────┘
                          ▲
                          │  service-role writes
                          │
┌──────────────────────────────────────────────────────────┐
│  GitHub Actions (.github/workflows/sync.yml)              │
│   cron 0,30 * * * *                                       │
│   • gspread → read Quay 1 Seller Lead Bank sheet          │
│   • HubSpot → fetch deal stages + call counts per DealID  │
│   • upsert into Supabase                                  │
└──────────────────────────────────────────────────────────┘
```

## Why Pages, not Streamlit

Sibling project `quay-leads-dashboard` runs the same data on Streamlit
Cloud. This Pages version exists for stack consistency with `quay-hubspot`
and `quay-clock` (all vanilla HTML/JS + Supabase), and to allow new
report pages to be added by the same patterns. Trade-off: data is
30 min stale instead of live-on-render.

## Setup (one-time)

### 1. Supabase

Open the project SQL editor and run each migration in
`supabase/migrations/` once:

- `2026-06-30_leads.sql` — leads + hs_deal_state tables + RLS

(The `lead_actions` and `staff` tables already exist — they're shared
with `quay-clock`.)

### 2. GitHub repo secrets

```bash
gh secret set HUBSPOT_TOKEN          -b "pat-na1-…"        -R Twigs002/quay-leads
gh secret set SUPABASE_SERVICE_KEY   -b "eyJ…"              -R Twigs002/quay-leads
gh secret set GCP_SA_JSON            < ~/Downloads/quay-leads-dashboard-cf0b1e395937.json -R Twigs002/quay-leads
```

### 3. Enable Pages

```bash
gh api -X POST repos/Twigs002/quay-leads/pages \
  -F source.branch=main -F source.path=/
```

### 4. First sync

```bash
gh workflow run sync.yml -R Twigs002/quay-leads
```

## Local dev

The frontend is pure HTML/CSS/JS — no build step.

```bash
cd public && python3 -m http.server 8000
open http://localhost:8000
```

Sign in with your `quay-clock` username + PIN. Data comes straight from
the live Supabase project — no separate dev environment needed.

To run the sync script manually:

```bash
cd scripts && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export HUBSPOT_TOKEN="pat-na1-…"
export SUPABASE_SERVICE_KEY="eyJ…"
export GCP_SA_JSON="$(cat ~/Downloads/quay-leads-dashboard-cf0b1e395937.json)"
python3 sync.py
```

## Project layout

```
quay-leads/
├── ./                    ← Pages serves from here
│   ├── index.html             ← shell + login
│   ├── styles.css             ← v2 light theme tokens
│   ├── app.js                 ← bootstrap, auth, router
│   ├── data.js                ← Supabase fetch helpers
│   ├── filters.js             ← shared filter state + URL sync
│   ├── theme.js               ← stage colours, chart palette
│   ├── views/
│   │   ├── overview.js
│   │   ├── sources.js
│   │   ├── pipeline.js
│   │   ├── action_tracker.js
│   │   └── raw_data.js
│   └── vendor/                ← Chart.js, DataTables, supabase-js
├── scripts/
│   ├── sync.py                ← sheet + HubSpot → Supabase
│   └── requirements.txt
├── supabase/migrations/
│   └── 2026-06-30_leads.sql
└── .github/workflows/
    └── sync.yml               ← cron 0,30 * * * *
```

## Related projects

- `Twigs002/quay-leads-dashboard` — Streamlit version (sibling, runs in parallel)
- `Twigs002/quay-hubspot` — out-of-date HubSpot deals dashboard (same Pages pattern)
- `Twigs002/quay-clock` — staff clock-in PWA (auth source of truth)
