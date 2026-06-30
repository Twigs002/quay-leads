"""
Sync the Quay 1 Seller Lead Bank → Supabase, every 30 min.

Reads:
  - Google Sheet via service account (read-only on the sheet)
  - HubSpot deal stages + per-deal call counts (batched)

Writes:
  - Supabase public.leads          (upsert by lowercased email)
  - Supabase public.hs_deal_state  (upsert by deal_id)
  - Supabase public.sync_status    (heartbeat + last error)

Idempotent. Safe to run on a cron; nothing is destructively replaced
without first being re-read in the next run.

Env vars (all required):
  HUBSPOT_TOKEN          HubSpot Private App token
  SUPABASE_URL           e.g. https://dqszbqiimbfvmmnpgpsb.supabase.co
  SUPABASE_SERVICE_KEY   service-role key (write access; bypasses RLS)
  GCP_SA_JSON            full service-account JSON (one line, escaped)
  SHEET_ID               Google Sheet ID
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import traceback
from datetime import datetime, timezone
from typing import Iterable

import gspread
import requests
from google.oauth2.service_account import Credentials
from supabase import Client, create_client

# ── Config ──────────────────────────────────────────────────────────────
HS_API = "https://api.hubapi.com"
HS_PROPS = [
    "dealname", "dealstage", "amount", "closedate",
    "hs_lastmodifieddate", "hubspot_owner_id", "pipeline",
    "hs_deal_stage_probability",
]
BATCH = 100
THROTTLE_S = 0.35  # ~3 req/s — well under HubSpot's 10/s sustained
SHEET_ID_DEFAULT = "1-36ANzAzzi5N0vmLG0hAVkBnFkhkFCh4fGXFenlexe0"
DEAL_RE = re.compile(r"DealID:\s*(\d+)", re.IGNORECASE)

# Column header → leads table column. Sheet headers in raw order.
LEAD_COL_MAP = {
    "Datestamp":        "datestamp",
    "Source":           "source",
    "ClientName":       "client_name",
    "PhoneNumber":      "phone",
    "Email":            "email",
    "PropertyAddress":  "property_address",
    "Suburb":           "suburb",
    "PropertyType":     "property_type",
    "Division":         "division",
    "HubspotDivID":     "hubspot_div_id",
    "IsLead":           "is_lead",
    "Timeline":         "timeline",
    "Relationship":     "relationship",
    "HubspotStatus":    "hubspot_status",
    "HubspotStatus2":   "hubspot_status2",
}


# ── Auth helpers ─────────────────────────────────────────────────────────
def _need(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"ERROR: env {name} not set")
    return v


def gspread_client() -> gspread.Client:
    sa_raw = _need("GCP_SA_JSON")
    sa = json.loads(sa_raw)
    creds = Credentials.from_service_account_info(
        sa,
        scopes=[
            "https://www.googleapis.com/auth/spreadsheets.readonly",
            "https://www.googleapis.com/auth/drive.readonly",
        ],
    )
    return gspread.authorize(creds)


def supabase_client() -> Client:
    return create_client(_need("SUPABASE_URL"), _need("SUPABASE_SERVICE_KEY"))


def hs_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {_need('HUBSPOT_TOKEN')}",
        "Content-Type": "application/json",
    })
    return s


# ── HubSpot HTTP w/ throttle + 429 back-off ─────────────────────────────
def hs_request(sess: requests.Session, method: str, url: str, **kwargs):
    backoff = 1
    for _ in range(6):
        time.sleep(THROTTLE_S)
        r = sess.request(method, url, timeout=30, **kwargs)
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", backoff))
            time.sleep(wait); backoff = min(60, backoff * 2); continue
        if r.status_code >= 500:
            time.sleep(backoff); backoff = min(60, backoff * 2); continue
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()
    raise RuntimeError(f"HubSpot retries exhausted: {url}")


def chunks(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ── Sheet → leads ───────────────────────────────────────────────────────
def fetch_sheet_leads(sheet_id: str) -> list[dict]:
    gc = gspread_client()
    ws = gc.open_by_key(sheet_id).worksheet("Leads")
    rows = ws.get_all_records()
    out: list[dict] = []
    seen: set[str] = set()
    for r in rows:
        email = str(r.get("Email") or "").strip().lower()
        if not email or "@" not in email:
            continue
        if email in seen:
            continue  # keep first occurrence; sheet is the order of arrival
        seen.add(email)

        rec: dict = {"email": email}
        for src, dst in LEAD_COL_MAP.items():
            if dst == "email":
                continue
            v = r.get(src)
            if v in (None, "", "NaN"):
                v = None
            elif dst == "datestamp":
                v = _parse_dt_dayfirst(v)
            else:
                v = str(v).strip()
                if dst == "division" and v == "UPDATED BELOW":
                    v = None
                if dst == "is_lead" and v and len(v) > 80:
                    v = "Other"  # long context blobs in some rows
            rec[dst] = v

        # parse deal_id from hubspot_status2
        h2 = (rec.get("hubspot_status2") or "")
        m = DEAL_RE.search(h2)
        rec["deal_id"] = m.group(1) if m else None
        out.append(rec)
    return out


def _parse_dt_dayfirst(v):
    """Accept 'dd/mm/yyyy hh:mm:ss' (sheet's default), ISO, or already a dt."""
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    s = str(v).strip()
    for fmt in ("%d/%m/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return None


# ── HubSpot → deal state ────────────────────────────────────────────────
def fetch_stage_labels(sess: requests.Session) -> dict[str, str]:
    data = hs_request(sess, "GET", f"{HS_API}/crm/v3/pipelines/deals")
    out: dict[str, str] = {}
    for pipe in (data or {}).get("results", []):
        for stage in pipe.get("stages", []):
            sid, label = stage.get("id"), stage.get("label")
            if sid:
                out[sid] = label or sid
    return out


def fetch_deals(sess: requests.Session, deal_ids: Iterable[str]) -> list[dict]:
    out: list[dict] = []
    for chunk in chunks(deal_ids, BATCH):
        body = {"properties": HS_PROPS, "inputs": [{"id": d} for d in chunk]}
        try:
            data = hs_request(sess, "POST", f"{HS_API}/crm/v3/objects/deals/batch/read", json=body)
        except RuntimeError:
            continue
        for rec in (data or {}).get("results", []):
            p = rec.get("properties") or {}
            out.append({
                "deal_id":           rec.get("id"),
                "current_stage_id":  p.get("dealstage"),
                "deal_name":         p.get("dealname"),
                "amount":            _to_float(p.get("amount")),
                "close_date":        p.get("closedate"),
                "hs_last_modified":  p.get("hs_lastmodifieddate"),
                "hubspot_owner_id":  p.get("hubspot_owner_id"),
                "pipeline":          p.get("pipeline"),
                "probability":       _to_float(p.get("hs_deal_stage_probability")),
            })
    return out


def fetch_call_counts(sess: requests.Session, deal_ids: Iterable[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for chunk in chunks(deal_ids, BATCH):
        body = {"inputs": [{"id": d} for d in chunk]}
        try:
            data = hs_request(sess, "POST", f"{HS_API}/crm/v4/associations/deals/calls/batch/read", json=body)
        except RuntimeError:
            continue
        for rec in (data or {}).get("results", []):
            did = (rec.get("from") or {}).get("id")
            if did:
                out[str(did)] = len(rec.get("to") or [])
        for d in chunk:
            out.setdefault(str(d), 0)
    return out


def _to_float(v):
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ── Supabase upserts ────────────────────────────────────────────────────
def upsert_chunked(sb: Client, table: str, rows: list[dict], on_conflict: str, chunk_size: int = 500):
    n = 0
    for c in chunks(rows, chunk_size):
        sb.table(table).upsert(c, on_conflict=on_conflict).execute()
        n += len(c)
    return n


def heartbeat(sb: Client, name: str, ok: bool, message: str = ""):
    sb.table("sync_status").upsert({
        "name": name,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
        "ok": ok,
        "message": message,
    }, on_conflict="name").execute()


# ── Main ────────────────────────────────────────────────────────────────
def main():
    sheet_id = os.environ.get("SHEET_ID", "").strip() or SHEET_ID_DEFAULT
    sb = supabase_client()
    sess = hs_session()

    try:
        print("→ reading sheet")
        leads = fetch_sheet_leads(sheet_id)
        print(f"  {len(leads):,} unique-email rows from Leads tab")

        deal_ids = sorted({l["deal_id"] for l in leads if l.get("deal_id")})
        print(f"→ {len(deal_ids):,} unique HubSpot DealIDs to enrich")

        print("→ fetching deal stages + call counts from HubSpot")
        labels = fetch_stage_labels(sess)
        deals = fetch_deals(sess, deal_ids)
        calls = fetch_call_counts(sess, deal_ids)
        # Merge call counts + readable stage labels
        deal_rows = []
        for d in deals:
            sid = d.get("current_stage_id")
            d["current_stage"] = labels.get(sid, sid)
            d["num_calls"] = calls.get(str(d["deal_id"]), 0)
            d["refreshed_at"] = datetime.now(timezone.utc).isoformat()
            deal_rows.append(d)
        # Include deal_ids that came back empty (deleted in HubSpot) as 0-call placeholders
        seen = {d["deal_id"] for d in deal_rows}
        for did in deal_ids:
            if did not in seen:
                deal_rows.append({
                    "deal_id": did, "num_calls": calls.get(did, 0),
                    "refreshed_at": datetime.now(timezone.utc).isoformat(),
                })
        print(f"  deal rows: {len(deal_rows):,}")

        print("→ upserting leads")
        n_leads = upsert_chunked(sb, "leads", leads, on_conflict="email")
        print(f"  upserted {n_leads:,}")

        print("→ upserting hs_deal_state")
        n_deals = upsert_chunked(sb, "hs_deal_state", deal_rows, on_conflict="deal_id")
        print(f"  upserted {n_deals:,}")

        heartbeat(sb, "leads_sync", ok=True, message=f"{n_leads} leads, {n_deals} deals")
        print(f"✓ done at {datetime.now(timezone.utc).isoformat()}")
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        traceback.print_exc()
        try:
            heartbeat(sb, "leads_sync", ok=False, message=msg[:500])
        except Exception:
            pass
        sys.exit(1)


if __name__ == "__main__":
    main()
