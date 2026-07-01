"""
Sync per-team daily activity → Supabase.team_activity_daily.

Runs alongside sync.py (same GitHub Action, same env vars, same HubSpot
token — no new secrets). Populates one row per (team, day) with:

  calls_dialfire   calls whose hs_object_source_id = 811260 (DialFire)
                   made against contacts owned by that team's owner
  calls_team       calls whose hs_object_source = CRM_UI (a human logged
                   the call in the HubSpot UI) against those contacts
  deals_dialfire   n8n-auto-created deals (source_id 223580) owned by
                   the team-owner — these are downstream of DialFire
                   marking a contact as LEAD
  deals_team       deals with source CRM_UI (created manually in HubSpot)
                   owned by the team-owner
  deals_other      any other origin (bulk actions, other integrations)

Windowing:
  --days N      backfill the last N days (default 3 — rolling top-up).
                First run: --days 45 to cover 30d + calendar-month.

Owner → team map is built from public.leads (Supabase). Each row has
hubspot_div_id + division; a unique count-vote picks the canonical
division for each owner_id in case the sheet has stray rows.

DialFire source id:      811260
n8n integration id:      223580
HubSpot search cap:      10,000 results per query — we window by day to
                         stay well under it.
"""

from __future__ import annotations

import argparse
import collections
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

import requests
from supabase import Client, create_client

HS_API = "https://api.hubapi.com"
THROTTLE_S = 0.35
BATCH = 100

DIALFIRE_SID = "811260"
N8N_SID = "223580"


# ── Auth ────────────────────────────────────────────────────────────────
def _need(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"ERROR: env {name} not set")
    return v


def supabase_client() -> Client:
    return create_client(_need("SUPABASE_URL"), _need("SUPABASE_SERVICE_KEY"))


def hs_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {_need('HUBSPOT_TOKEN')}",
        "Content-Type": "application/json",
    })
    return s


def hs_request(sess: requests.Session, method: str, url: str, **kwargs):
    backoff = 1
    for _ in range(6):
        time.sleep(THROTTLE_S)
        r = sess.request(method, url, timeout=45, **kwargs)
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", backoff))
            time.sleep(wait); backoff = min(60, backoff * 2); continue
        if r.status_code >= 500:
            time.sleep(backoff); backoff = min(60, backoff * 2); continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError(f"HubSpot retries exhausted: {url}")


def chunks(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ── Owner → team map ────────────────────────────────────────────────────
def owner_to_team_from_supabase(sb: Client) -> dict[str, str]:
    """Vote from the leads mirror: each owner_id maps to its most-common
    non-empty division. Owner_ids with no majority-clear division are
    dropped."""
    rows = sb.table("leads") \
        .select("hubspot_div_id, division") \
        .not_.is_("hubspot_div_id", "null") \
        .not_.is_("division", "null") \
        .execute().data or []

    votes: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for r in rows:
        oid = str(r.get("hubspot_div_id") or "").strip()
        div = (r.get("division") or "").strip()
        if not oid or not div or div.upper() == "UPDATED BELOW":
            continue
        votes[oid][div] += 1

    return {oid: c.most_common(1)[0][0] for oid, c in votes.items() if c}


# ── HubSpot search helpers ──────────────────────────────────────────────
def _iso_ms(dt: datetime) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)


def search_all(sess: requests.Session, object_type: str, body: dict) -> list[dict]:
    """Fully paginate a /crm/v3/objects/{type}/search call. Caller MUST
    scope the filter tightly enough to stay under 10,000 results."""
    out: list[dict] = []
    after = None
    for _ in range(200):
        b = dict(body)
        if after:
            b["after"] = after
        data = hs_request(sess, "POST", f"{HS_API}/crm/v3/objects/{object_type}/search", json=b)
        out.extend(data.get("results") or [])
        after = ((data.get("paging") or {}).get("next") or {}).get("after")
        if not after:
            return out
    print(f"  ! pagination cap hit on {object_type}", flush=True)
    return out


# ── Deals per team per day ──────────────────────────────────────────────
def deals_for_day(sess: requests.Session, day: date) -> list[dict]:
    """Return deals CREATED on this UTC day with owner + source props."""
    day_start = _iso_ms(datetime(day.year, day.month, day.day))
    day_end = _iso_ms(datetime(day.year, day.month, day.day) + timedelta(days=1))
    body = {
        "limit": 100,
        "properties": ["hubspot_owner_id", "hs_object_source", "hs_object_source_id", "createdate"],
        "filterGroups": [{"filters": [
            {"propertyName": "createdate", "operator": "GTE", "value": str(day_start)},
            {"propertyName": "createdate", "operator": "LT",  "value": str(day_end)},
        ]}],
    }
    return search_all(sess, "deals", body)


def classify_deal(props: dict) -> str:
    src = (props.get("hs_object_source") or "").upper()
    sid = str(props.get("hs_object_source_id") or "")
    if src == "INTEGRATION" and sid == DIALFIRE_SID:
        return "dialfire"
    if src == "INTEGRATION" and sid == N8N_SID:
        # n8n creates deals downstream of DialFire flagging a contact.
        # Bucket them as DialFire-originated.
        return "dialfire"
    if src == "CRM_UI":
        return "team"
    return "other"


# ── Calls per team per day ──────────────────────────────────────────────
def calls_for_day(sess: requests.Session, day: date) -> list[dict]:
    """Calls whose hs_timestamp lands in this UTC day, with associated
    contact IDs inline (up to 100 associations per call — plenty)."""
    day_start = _iso_ms(datetime(day.year, day.month, day.day))
    day_end = _iso_ms(datetime(day.year, day.month, day.day) + timedelta(days=1))
    body = {
        "limit": 100,
        "properties": ["hs_timestamp", "hs_object_source", "hs_object_source_id"],
        "filterGroups": [{"filters": [
            {"propertyName": "hs_timestamp", "operator": "GTE", "value": str(day_start)},
            {"propertyName": "hs_timestamp", "operator": "LT",  "value": str(day_end)},
        ]}],
    }
    # Search doesn't include associations directly; we fetch them separately
    # via batch/read/associations. That's fine — one association batch per
    # 100 calls is still fast.
    return search_all(sess, "calls", body)


def call_contact_map(sess: requests.Session, call_ids: list[str]) -> dict[str, str]:
    """{call_id: first_associated_contact_id}. Calls with no contact are
    dropped (we can't attribute them to a team)."""
    out: dict[str, str] = {}
    for chunk in chunks(call_ids, BATCH):
        body = {"inputs": [{"id": c} for c in chunk]}
        data = hs_request(sess, "POST", f"{HS_API}/crm/v4/associations/calls/contacts/batch/read", json=body)
        for rec in data.get("results") or []:
            cid = (rec.get("from") or {}).get("id")
            tos = rec.get("to") or []
            if cid and tos:
                out[str(cid)] = str(tos[0].get("toObjectId"))
    return out


def contact_owner_map(sess: requests.Session, contact_ids: list[str]) -> dict[str, str]:
    """{contact_id: hubspot_owner_id}. Missing owners → contact skipped."""
    out: dict[str, str] = {}
    for chunk in chunks(contact_ids, BATCH):
        body = {
            "inputs": [{"id": c} for c in chunk],
            "properties": ["hubspot_owner_id"],
        }
        data = hs_request(sess, "POST", f"{HS_API}/crm/v3/objects/contacts/batch/read", json=body)
        for rec in data.get("results") or []:
            oid = (rec.get("properties") or {}).get("hubspot_owner_id")
            if oid:
                out[str(rec["id"])] = str(oid)
    return out


def classify_call_source(props: dict) -> str:
    src = (props.get("hs_object_source") or "").upper()
    sid = str(props.get("hs_object_source_id") or "")
    if src == "INTEGRATION" and sid == DIALFIRE_SID:
        return "dialfire"
    if src == "CRM_UI":
        return "team"
    return "other"


# ── Main sync loop ──────────────────────────────────────────────────────
def sync_day(sess: requests.Session, owner_team: dict[str, str], day: date,
             contact_owner_cache: dict[str, str]) -> dict[str, dict]:
    """Return {team: {calls_dialfire, calls_team, deals_dialfire, deals_team, deals_other}}."""
    result: dict[str, dict] = collections.defaultdict(lambda: {
        "calls_dialfire": 0, "calls_team": 0,
        "deals_dialfire": 0, "deals_team": 0, "deals_other": 0,
    })

    # Deals
    deals = deals_for_day(sess, day)
    for d in deals:
        props = d.get("properties") or {}
        owner_id = str(props.get("hubspot_owner_id") or "")
        team = owner_team.get(owner_id)
        if not team:
            continue
        origin = classify_deal(props)
        result[team][f"deals_{origin}"] += 1

    # Calls
    calls = calls_for_day(sess, day)
    if calls:
        # Batch-fetch call → contact associations
        call_ids = [c["id"] for c in calls]
        cmap = call_contact_map(sess, call_ids)

        # Batch-fetch owner for contacts not yet cached
        needed = [cid for cid in set(cmap.values()) if cid not in contact_owner_cache]
        if needed:
            fresh = contact_owner_map(sess, needed)
            contact_owner_cache.update(fresh)
            # remember misses too (empty string) so we don't re-request
            for cid in needed:
                contact_owner_cache.setdefault(cid, "")

        for c in calls:
            contact_id = cmap.get(c["id"])
            if not contact_id:
                continue
            owner_id = contact_owner_cache.get(contact_id, "")
            team = owner_team.get(owner_id)
            if not team:
                continue
            origin = classify_call_source(c.get("properties") or {})
            if origin == "dialfire":
                result[team]["calls_dialfire"] += 1
            elif origin == "team":
                result[team]["calls_team"] += 1

    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=3,
                   help="Backfill this many days ending today (default 3).")
    args = p.parse_args()

    sb = supabase_client()
    sess = hs_session()

    print("→ building owner → team map from Supabase leads")
    owner_team = owner_to_team_from_supabase(sb)
    print(f"  {len(owner_team)} team-owners mapped")
    if not owner_team:
        sys.exit("ERROR: no owner→team map — has scripts/sync.py run yet?")

    today = date.today()
    days = [today - timedelta(days=i) for i in range(args.days, -1, -1)]
    print(f"→ syncing {len(days)} days: {days[0]} → {days[-1]}")

    contact_owner_cache: dict[str, str] = {}
    rows_to_upsert: list[dict] = []

    for d in days:
        t0 = time.time()
        agg = sync_day(sess, owner_team, d, contact_owner_cache)
        total = sum(sum(v.values()) for v in agg.values())
        print(f"  {d}: {len(agg)} teams, {total} events "
              f"(cache={len(contact_owner_cache)}) [{time.time()-t0:.1f}s]", flush=True)
        for team, counts in agg.items():
            rows_to_upsert.append({
                "team": team,
                "day": d.isoformat(),
                **counts,
                "refreshed_at": datetime.now(timezone.utc).isoformat(),
            })

    # Also emit zero-rows for every (team, day) with no activity so the
    # frontend can distinguish "no data yet" from "data says zero".
    # Only for days we did sync — never backfill deeper.
    with_data = {(r["team"], r["day"]) for r in rows_to_upsert}
    for d in days:
        for team in set(owner_team.values()):
            key = (team, d.isoformat())
            if key in with_data:
                continue
            rows_to_upsert.append({
                "team": team, "day": d.isoformat(),
                "calls_dialfire": 0, "calls_team": 0,
                "deals_dialfire": 0, "deals_team": 0, "deals_other": 0,
                "refreshed_at": datetime.now(timezone.utc).isoformat(),
            })

    print(f"→ upserting {len(rows_to_upsert)} rows to team_activity_daily")
    for c in chunks(rows_to_upsert, 500):
        sb.table("team_activity_daily").upsert(c, on_conflict="team,day").execute()

    # Heartbeat (reuses existing sync_status table).
    sb.table("sync_status").upsert({
        "name": "team_activity_sync",
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
        "ok": True,
        "message": f"{len(days)} days, {len(owner_team)} teams",
    }, on_conflict="name").execute()
    print("✓ done")


if __name__ == "__main__":
    main()
