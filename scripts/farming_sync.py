#!/usr/bin/env python3
"""Ingest the division-area breakdown → public.farming_areas.

The "division area breakdown" sheet lists the suburbs each division farms.
That suburb list IS our farming area (DAB): a lead whose suburb is not in it
is out of area / unqualified. This reads that sheet and upserts one row per
suburb.

Column detection is fuzzy (headers vary): the suburb column is the one whose
header contains "suburb"; area/team is "area"/"division"/"team"; group is
"group" or a WSB/NS/SP/SW value. Override with env if the guess is wrong.

Env:
  GCP_SA_JSON        Google service-account JSON (same as sync.py)
  SUPABASE_URL, SUPABASE_SERVICE_KEY
  FARMING_SHEET_ID   workbook id (default: the leads workbook)
  FARMING_WORKSHEET  tab name (default: "Division Area Breakdown")
  FARMING_SUBURB_COL / FARMING_AREA_COL / FARMING_GROUP_COL
                     explicit header names to override fuzzy detection
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

import gspread
from google.oauth2.service_account import Credentials
from supabase import Client, create_client

SHEET_ID_DEFAULT = "1-36ANzAzzi5N0vmLG0hAVkBnFkhkFCh4fGXFenlexe0"
WORKSHEET_DEFAULT = "Division Area Breakdown"
GROUPS = {"WSB", "NS", "SP", "SW"}


def _need(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"ERROR: env {name} not set")
    return v


def gspread_client() -> gspread.Client:
    sa = json.loads(_need("GCP_SA_JSON"))
    creds = Credentials.from_service_account_info(sa, scopes=[
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
    ])
    return gspread.authorize(creds)


def supabase_client() -> Client:
    return create_client(_need("SUPABASE_URL"), _need("SUPABASE_SERVICE_KEY"))


def _find_col(headers: list[str], needles: list[str], override: str | None):
    if override:
        for i, h in enumerate(headers):
            if h.strip().lower() == override.strip().lower():
                return i
        sys.exit(f"ERROR: override column '{override}' not found in {headers}")
    for i, h in enumerate(headers):
        hl = h.strip().lower()
        if any(n in hl for n in needles):
            return i
    return None


def main():
    sheet_id = os.environ.get("FARMING_SHEET_ID", "").strip() or SHEET_ID_DEFAULT
    ws_name = os.environ.get("FARMING_WORKSHEET", "").strip() or WORKSHEET_DEFAULT
    gc = gspread_client()
    try:
        ws = gc.open_by_key(sheet_id).worksheet(ws_name)
    except gspread.WorksheetNotFound:
        tabs = [w.title for w in gc.open_by_key(sheet_id).worksheets()]
        sys.exit(f"ERROR: worksheet '{ws_name}' not found. Available tabs: {tabs}")

    rows = ws.get_all_values()
    if not rows:
        sys.exit("ERROR: sheet is empty")
    headers = rows[0]
    print(f"→ '{ws_name}' headers: {headers}")

    sub_i = _find_col(headers, ["suburb"], os.environ.get("FARMING_SUBURB_COL"))
    area_i = _find_col(headers, ["area", "division", "team"], os.environ.get("FARMING_AREA_COL"))
    grp_i = _find_col(headers, ["group"], os.environ.get("FARMING_GROUP_COL"))
    if sub_i is None:
        sys.exit(f"ERROR: could not find a suburb column in {headers}. "
                 f"Set FARMING_SUBURB_COL to the exact header.")
    print(f"  suburb col: {headers[sub_i]!r} · area col: "
          f"{headers[area_i] if area_i is not None else None!r} · group col: "
          f"{headers[grp_i] if grp_i is not None else None!r}")

    seen: dict[str, dict] = {}
    for r in rows[1:]:
        if sub_i >= len(r):
            continue
        suburb = (r[sub_i] or "").strip()
        if not suburb:
            continue
        key = suburb.lower()
        area = (r[area_i].strip() if area_i is not None and area_i < len(r) else None) or None
        grp = (r[grp_i].strip().upper() if grp_i is not None and grp_i < len(r) else None) or None
        if grp and grp not in GROUPS:
            grp = None
        # First occurrence wins; a suburb listed twice keeps its first area.
        seen.setdefault(key, {
            "suburb_lc": key,
            "suburb": suburb,
            "area": area,
            "open_border_group": grp,
            "in_farming": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    payload = list(seen.values())
    if not payload:
        sys.exit("ERROR: no suburbs parsed — check the column detection above.")

    sb = supabase_client()
    for i in range(0, len(payload), 500):
        sb.table("farming_areas").upsert(payload[i:i + 500], on_conflict="suburb_lc").execute()
    print(f"✓ upserted {len(payload)} farmed suburbs into farming_areas")

    sb.table("sync_status").upsert({
        "name": "farming_sync",
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
        "ok": True,
        "message": f"{len(payload)} suburbs from '{ws_name}'",
    }, on_conflict="name").execute()


if __name__ == "__main__":
    main()
