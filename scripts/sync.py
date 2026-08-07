"""
Sync the Quay 1 Seller Lead Bank → Supabase, every 30 min.

Reads:
  - Google Sheet via service account (read-only on the sheet)
  - HubSpot deal stages + per-deal call counts (batched)
  - HubSpot call engagements (details for the Track-tab history)

Writes:
  - Supabase public.leads          (upsert by lowercased email)
  - Supabase public.hs_deal_state  (upsert by deal_id)
  - Supabase public.hs_deal_calls  (upsert by (deal_id, call_id))
  - Supabase public.sales_register (upsert by id; commission actuals, no PII)
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
from zoneinfo import ZoneInfo

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
    "hs_createdate",  # 72h reassignment clock origin
    # How the deal was created. Auto-created deals come through the Dialfire→n8n
    # pipe and read source_label=INTEGRATION, detail_1=n8n.cloud; manual deals
    # read CRM_UI. Lets the dashboard split auto (n8n) vs manual.
    "hs_object_source_label",
    "hs_object_source_detail_1",
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

# ── Sales / commission register (actuals) ─────────────────────────────────
# A SEPARATE Google Sheet: the company deal & commission register. Feeds real
# banked-commission actuals into Costings/CFO + the Actuals view. We ingest ONLY
# economic fields, the address, the team, and the lead broker's name — NEVER any
# seller/purchaser PII (names, IDs, cellphones, emails are deliberately dropped).
REGISTER_SHEET_ID_DEFAULT = "1huZJUJWPBJHV8zyievMdyJu2fwDcbU2c4XUdsjLV7k0"
# Sheet header → sales_register column. Anything not listed here is ignored
# (which is how all the PII columns get excluded).
REGISTER_COL_MAP = {
    "id":                "id",
    "divisionName":      "division_name",
    "dealStatus":        "deal_status",
    "propertyType":      "property_type",
    "refNumber":         "ref_number",
    "transferDate":      "transfer_date",
    "acceptanceDate":    "acceptance_date",
    "poDate":            "po_date",
    "brokerPayDate":     "broker_pay_date",
    "streetNumber":      "street_number",
    "streetName":        "street_name",
    "suburb":            "suburb",
    "township":          "township",
    "purchasePrice":     "purchase_price",
    "commission":        "commission_pct",
    "commissionExclVat": "commission_excl_vat",
    "commissionInclVat": "commission_incl_vat",
    "totalGrossComm":    "total_gross_comm",
    "quay1Comm":         "quay1_comm",
    "quay1GrossComm":    "quay1_gross_comm",
    "quay1CommNet":      "quay1_comm_net",
    "broker1FullName":   "broker1_name",
    "broker1CommGross":  "broker1_comm_gross",
}
REGISTER_DATE_COLS = {"transfer_date", "acceptance_date", "po_date", "broker_pay_date"}
REGISTER_NUM_COLS = {
    "purchase_price", "commission_pct", "commission_excl_vat", "commission_incl_vat",
    "total_gross_comm", "quay1_comm", "quay1_gross_comm", "quay1_comm_net", "broker1_comm_gross",
}
REGISTER_TITLE_CODE = {"Full Title": "FT", "Sectional Title": "ST"}


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


# Quay 1 operates in South Africa — sheet timestamps are SAST (UTC+2, no DST).
# Naive parses must be tagged SAST and converted to UTC, NOT stamped UTC.
SAST = ZoneInfo("Africa/Johannesburg")


def _defuture(dt, now):
    """A lead can never arrive in the future. Some automated feeds (Google
    Forms, bots) write dates month-first (US M/D/Y) while the sheet default is
    day-first, so an ambiguous date gets its day/month swapped and can land
    ahead of now. If the day/month are interchangeable (both <= 12) and
    swapping yields a past date, swap them back."""
    if dt > now and dt.day <= 12 and dt.month <= 12:
        try:
            swapped = dt.replace(month=dt.day, day=dt.month)
            if swapped <= now:
                return swapped
        except ValueError:
            pass
    return dt


def _parse_dt_dayfirst(v):
    """Accept 'dd/mm/yyyy hh:mm:ss' (sheet's default), ISO, or already a dt."""
    if v in (None, ""):
        return None
    now = datetime.now(SAST)
    dt = None
    if isinstance(v, datetime):
        dt = (v if v.tzinfo else v.replace(tzinfo=SAST)).astimezone(SAST)
    else:
        s = str(v).strip()
        for fmt in ("%d/%m/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(s, fmt).replace(tzinfo=SAST)
                break
            except ValueError:
                continue
    if dt is None:
        return None
    return _defuture(dt, now).astimezone(timezone.utc).isoformat()


def _parse_date_only(v):
    """Register dates land as 'YYYY-MM-DD HH:MM:SS' (or blank). Return the date
    part as an ISO 'YYYY-MM-DD' string, or None. Out-of-range typos (e.g. a 2052
    year) are kept as-is; the dashboard filters to a sane window."""
    if v in (None, ""):
        return None
    s = str(v).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


# ── Sheet → sales register (actuals) ─────────────────────────────────────
def fetch_sales_register(sheet_id: str) -> list[dict]:
    """Read the commission register sheet → sales_register rows. Economic +
    address + team + lead-broker fields only; all client PII is dropped by
    virtue of not being in REGISTER_COL_MAP."""
    gc = gspread_client()
    ws = gc.open_by_key(sheet_id).get_worksheet(0)  # first tab (gid=0)
    rows = ws.get_all_records()
    out: list[dict] = []
    seen: set[str] = set()
    for r in rows:
        rid = str(r.get("id") or "").strip()
        if not rid or rid in seen:
            continue  # rows without an id, or dupes, are skipped (id is the PK)
        seen.add(rid)
        rec: dict = {}
        for src, dst in REGISTER_COL_MAP.items():
            v = r.get(src)
            if v in (None, "", "NaN"):
                rec[dst] = None
            elif dst in REGISTER_DATE_COLS:
                rec[dst] = _parse_date_only(v)
            elif dst in REGISTER_NUM_COLS:
                rec[dst] = _to_float(v)
            else:
                rec[dst] = str(v).strip()
        # Derived fields.
        rec["title_code"] = REGISTER_TITLE_CODE.get(rec.get("property_type") or "", None)
        rec["is_rental"] = bool((rec.get("division_name") or "").startswith("Rentals"))
        rec["synced_at"] = datetime.now(timezone.utc).isoformat()
        out.append(rec)
    return out


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


def fetch_deals(sess: requests.Session, deal_ids: Iterable[str]) -> tuple[list[dict], set[str]]:
    """Return (rows, failed_ids).

    failed_ids = deal_ids that belonged to a batch whose HubSpot call errored
    out (5xx, network, retry-exhausted). The caller MUST exclude these from
    the upsert so the existing Supabase rows are preserved instead of being
    overwritten with empty placeholders.
    """
    out: list[dict] = []
    failed: set[str] = set()
    for chunk in chunks(deal_ids, BATCH):
        body = {"properties": HS_PROPS, "inputs": [{"id": d} for d in chunk]}
        try:
            data = hs_request(sess, "POST", f"{HS_API}/crm/v3/objects/deals/batch/read", json=body)
        except RuntimeError:
            failed.update(str(d) for d in chunk)
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
                "hs_createdate":     p.get("hs_createdate"),
                "hs_object_source":  p.get("hs_object_source_label"),
                "hs_object_source_detail": p.get("hs_object_source_detail_1"),
            })
    return out, failed


def fetch_pipeline_value_by_stage(sess: requests.Session, labels: dict[str, str]) -> list[dict]:
    """Aggregate the WHOLE default sales pipeline (every deal with amount > 0)
    by stage: gross amount, probability-weighted amount, deal count, open flag.

    Unlike hs_deal_state (seller-lead deals only), this walks the entire deal
    book via the Search API so the CFO view can show real pipeline value. Best
    effort: any error returns [] so it never breaks the core sync.
    """
    url = f"{HS_API}/crm/v3/objects/deals/search"
    agg: dict[str, dict] = {}
    after: str | None = None
    try:
        while True:
            body = {
                "filterGroups": [{"filters": [
                    {"propertyName": "amount", "operator": "GT", "value": "0"},
                    {"propertyName": "pipeline", "operator": "EQ", "value": "default"},
                ]}],
                "properties": ["dealstage", "amount", "hs_deal_stage_probability", "hs_is_closed"],
                "limit": 100,
            }
            if after:
                body["after"] = after
            data = hs_request(sess, "POST", url, json=body)
            for rec in (data or {}).get("results", []):
                p = rec.get("properties") or {}
                sid = p.get("dealstage")
                amt = _to_float(p.get("amount")) or 0.0
                prob = _to_float(p.get("hs_deal_stage_probability")) or 0.0
                a = agg.setdefault(sid, {"gross": 0.0, "weighted": 0.0, "count": 0, "is_open": True})
                a["gross"] += amt
                a["weighted"] += amt * prob
                a["count"] += 1
                a["is_open"] = (p.get("hs_is_closed") == "false")
            after = (((data or {}).get("paging") or {}).get("next") or {}).get("after")
            if not after:
                break
    except Exception as exc:  # noqa: BLE001 - additive aggregate must never sink the sync
        print(f"  ! pipeline_stage_value aggregate failed: {exc}")
        return []
    now = datetime.now(timezone.utc).isoformat()
    return [{
        "stage":      labels.get(sid, sid),
        "is_open":    a["is_open"],
        "gross":      round(a["gross"], 2),
        "weighted":   round(a["weighted"], 2),
        "deal_count": a["count"],
        "updated_at": now,
    } for sid, a in agg.items() if sid]


def fetch_call_counts(sess: requests.Session, deal_ids: Iterable[str]) -> tuple[dict[str, int], dict[str, list[str]], set[str]]:
    """Return ({deal_id: count}, {deal_id: [call_id, ...]}, failed_ids).

    Same contract as fetch_deals: failed batches must not overwrite known-
    good num_calls. The call-id map lets the caller fetch full call details
    downstream (for hs_deal_calls). Deals with zero calls appear in the
    count map (as 0) but NOT in the id map, so the caller can iterate the
    id map without spurious empty entries.
    """
    counts: dict[str, int] = {}
    ids: dict[str, list[str]] = {}
    failed: set[str] = set()
    for chunk in chunks(deal_ids, BATCH):
        body = {"inputs": [{"id": d} for d in chunk]}
        try:
            data = hs_request(sess, "POST", f"{HS_API}/crm/v4/associations/deals/calls/batch/read", json=body)
        except RuntimeError:
            failed.update(str(d) for d in chunk)
            continue
        for rec in (data or {}).get("results", []):
            did = (rec.get("from") or {}).get("id")
            if not did:
                continue
            tos = rec.get("to") or []
            counts[str(did)] = len(tos)
            call_ids = [str(t.get("toObjectId")) for t in tos if t.get("toObjectId")]
            if call_ids:
                ids[str(did)] = call_ids
        # Only zero-out IDs that came from SUCCESSFUL batches and weren't returned.
        # (Failed-batch IDs stay absent from `counts` so the upsert skips them.)
        for d in chunk:
            counts.setdefault(str(d), 0)
    return counts, ids, failed


# ── HubSpot → call details (Track-tab history) ──────────────────────────
HS_CALL_PROPS = [
    "hs_timestamp",
    "hs_call_direction",
    "hs_call_disposition",
    "hs_call_duration",
    "hs_call_body",
    "hubspot_owner_id",
]


def fetch_call_details(sess: requests.Session, call_ids: Iterable[str]) -> tuple[dict[str, dict], set[str]]:
    """Return ({call_id: {ts, direction, disposition, duration_sec, notes,
    hubspot_owner_id}}, failed_ids).

    Uses /crm/v3/objects/calls/batch/read so we only make one API call per
    100 IDs regardless of how they distribute across deals.
    """
    out: dict[str, dict] = {}
    failed: set[str] = set()
    for chunk in chunks(sorted(set(call_ids)), BATCH):
        body = {"properties": HS_CALL_PROPS, "inputs": [{"id": c} for c in chunk]}
        try:
            data = hs_request(sess, "POST", f"{HS_API}/crm/v3/objects/calls/batch/read", json=body)
        except RuntimeError:
            failed.update(str(c) for c in chunk)
            continue
        for rec in (data or {}).get("results", []):
            p = rec.get("properties") or {}
            dur_ms = p.get("hs_call_duration")
            try:
                dur_sec = int(dur_ms) // 1000 if dur_ms not in (None, "") else None
            except (TypeError, ValueError):
                dur_sec = None
            out[str(rec.get("id"))] = {
                "ts":               p.get("hs_timestamp"),
                "direction":        p.get("hs_call_direction"),
                "disposition":      p.get("hs_call_disposition"),
                "duration_sec":     dur_sec,
                "notes":            _strip_html(p.get("hs_call_body")),
                "hubspot_owner_id": p.get("hubspot_owner_id"),
            }
    return out, failed


_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_html(s):
    """HubSpot's hs_call_body is HTML (from the CRM UI). Return plain text,
    collapsed whitespace, capped at 4KB so a runaway note can't blow up a
    row. Returns None if the input is empty."""
    if not s:
        return None
    txt = _HTML_TAG_RE.sub(" ", str(s))
    txt = _WS_RE.sub(" ", txt).strip()
    return (txt[:4000] if len(txt) > 4000 else txt) or None


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
        deals, deals_failed = fetch_deals(sess, deal_ids)
        calls, deal_call_ids, calls_failed = fetch_call_counts(sess, deal_ids)
        # IDs that belonged to a failed batch on EITHER side are excluded —
        # never overwrite real Supabase rows with placeholders on transient errors.
        failed_ids = deals_failed | calls_failed
        if failed_ids:
            print(f"  ! {len(failed_ids):,} deal_ids in failed batches — skipping (preserving existing rows)")

        # Merge call counts + readable stage labels
        deal_rows: list[dict] = []
        for d in deals:
            did = str(d.get("deal_id") or "")
            if not did or did in failed_ids:
                continue
            sid = d.get("current_stage_id")
            d["current_stage"] = labels.get(sid, sid)
            d["num_calls"] = calls.get(did, 0)
            d["refreshed_at"] = datetime.now(timezone.utc).isoformat()
            deal_rows.append(d)

        # Placeholder rows ONLY for IDs that came back empty from a SUCCESSFUL
        # batch (deal deleted in HubSpot). Failed-batch IDs are excluded.
        seen = {str(d["deal_id"]) for d in deal_rows}
        for did in deal_ids:
            did = str(did)
            if did in failed_ids or did in seen:
                continue
            if did not in calls:  # only "missing" if we never even got a call-count answer
                continue
            deal_rows.append({
                "deal_id": did, "num_calls": calls.get(did, 0),
                "refreshed_at": datetime.now(timezone.utc).isoformat(),
            })

        # Dedupe by deal_id — HubSpot occasionally returns >1 record for the
        # same input (merged deals, archived aliases). Last write wins.
        by_id: dict[str, dict] = {}
        for d in deal_rows:
            if d.get("deal_id"):
                by_id[str(d["deal_id"])] = d
        deal_rows = list(by_id.values())
        print(f"  deal rows: {len(deal_rows):,}")

        print("→ upserting leads")
        n_leads = upsert_chunked(sb, "leads", leads, on_conflict="email")
        print(f"  upserted {n_leads:,}")

        print("→ upserting hs_deal_state")
        n_deals = upsert_chunked(sb, "hs_deal_state", deal_rows, on_conflict="deal_id")
        print(f"  upserted {n_deals:,}")

        # Whole-book pipeline value by stage (all default-pipeline deals with an
        # amount, not just seller-lead deals) → pipeline_stage_value. Additive
        # and self-contained; a failure here must not affect the rows above.
        try:
            print("→ aggregating whole-book pipeline value by stage")
            stage_rows = fetch_pipeline_value_by_stage(sess, labels)
            if stage_rows:
                # Replace the whole table so stages absent this run don't linger.
                sb.table("pipeline_stage_value").delete().neq("stage", "").execute()
                n_sv = upsert_chunked(sb, "pipeline_stage_value", stage_rows, on_conflict="stage")
                print(f"  pipeline_stage_value rows: {n_sv:,}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ! pipeline_stage_value step skipped: {exc}")

        # Call details for the Track-tab per-lead history. We already have
        # deal_id → [call_id, ...] from fetch_call_counts; fetch each unique
        # call once, then explode back into (deal_id, call_id) rows.
        unique_call_ids: set[str] = set()
        for cids in deal_call_ids.values():
            unique_call_ids.update(cids)
        print(f"→ fetching details for {len(unique_call_ids):,} unique calls")
        call_details, call_details_failed = ({}, set())
        if unique_call_ids:
            call_details, call_details_failed = fetch_call_details(sess, unique_call_ids)
            if call_details_failed:
                print(f"  ! {len(call_details_failed):,} call_ids in failed batches — skipping")

        call_rows: list[dict] = []
        refreshed_now = datetime.now(timezone.utc).isoformat()
        for did, cids in deal_call_ids.items():
            if did in failed_ids:
                continue  # never overwrite good rows during a transient failure
            for cid in cids:
                det = call_details.get(cid)
                if not det:
                    continue  # failed batch or deleted call — skip silently
                call_rows.append({
                    "deal_id":          did,
                    "call_id":          cid,
                    "ts":               det["ts"],
                    "direction":        det["direction"],
                    "disposition":      det["disposition"],
                    "hubspot_owner_id": det["hubspot_owner_id"],
                    "duration_sec":     det["duration_sec"],
                    "notes":            det["notes"],
                    "refreshed_at":     refreshed_now,
                })
        print(f"→ upserting hs_deal_calls")
        n_calls = upsert_chunked(sb, "hs_deal_calls", call_rows, on_conflict="deal_id,call_id") if call_rows else 0
        print(f"  upserted {n_calls:,}")

        # Sales / commission register (actuals). Best-effort + self-contained:
        # a separate sheet with its own heartbeat, so a failure here never breaks
        # the core leads sync above. Skips cleanly if the sheet isn't shared yet.
        try:
            reg_id = os.environ.get("REGISTER_SHEET_ID", "").strip() or REGISTER_SHEET_ID_DEFAULT
            print("→ reading sales register")
            reg_rows = fetch_sales_register(reg_id)
            n_reg = upsert_chunked(sb, "sales_register", reg_rows, on_conflict="id") if reg_rows else 0
            print(f"  upserted {n_reg:,} sales_register rows")
            heartbeat(sb, "sales_register_sync", ok=True, message=f"{n_reg} register rows")
        except Exception as exc:  # noqa: BLE001
            print(f"  ! sales_register step skipped: {exc}")
            try:
                heartbeat(sb, "sales_register_sync", ok=False, message=str(exc)[:500])
            except Exception:
                pass

        heartbeat(sb, "leads_sync", ok=True, message=f"{n_leads} leads, {n_deals} deals, {n_calls} calls")
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
