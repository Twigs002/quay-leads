#!/usr/bin/env python3
"""Open-border stale-lead reassignment evaluator.

Rule (from the reassignment migration):
  A deal in a QUALIFYING stage (External / Calling / Inbound Lead), with
  ZERO logged calls, whose 72h clock (max of hs_createdate and
  last_reassigned_at) has elapsed, and whose current owner maps to a team
  that is in an OPEN-BORDER group with can_originate + active on, is moved
  to a RANDOM OTHER team in the SAME group that can_receive, is active, has
  a HubSpot owner id, and has NOT already held this deal (anti ping-pong).

  Both the deal owner and every associated contact owner would be updated
  in HubSpot. Every decision (moved / would-move / skipped / error) is
  written to public.lead_reassignments.

SAFETY:
  Default mode is DRY-RUN: it writes audit rows with dry_run=true and does
  NOT touch HubSpot. Live apply requires BOTH `--apply` AND env
  REASSIGN_ARM=1; until the user explicitly arms it, nothing moves.

  Daily cadence (once a day) is enforced by the caller (GitHub Actions
  cron), plus an in-script 20h dedupe so a re-run the same day doesn't spam
  the log with duplicate previews.

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY. For live apply only: HUBSPOT_TOKEN.
"""
from __future__ import annotations

import argparse
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone

import requests
from supabase import Client, create_client

# Stages a deal must be sitting in to be reassignable. Must match the labels
# the sync writes into hs_deal_state.current_stage (and REASSIGN_STAGES in
# data.js — keep the three in sync).
QUALIFYING_STAGES = ["External Lead", "Calling Lead", "Inbound Lead"]
IDLE_HOURS = 72
DEDUPE_HOURS = 20          # don't re-log the same deal within a day
HS_API = "https://api.hubapi.com"
THROTTLE_S = 0.35


def _need(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"ERROR: env {name} not set")
    return v


def supabase_client() -> Client:
    return create_client(_need("SUPABASE_URL"), _need("SUPABASE_SERVICE_KEY"))


def _parse_ts(s):
    """Parse a Postgres/HubSpot timestamp into an aware UTC datetime, or None.
    Accepts ISO 8601 with Z or offset, and epoch-millisecond strings."""
    if not s:
        return None
    s = str(s).strip()
    if not s:
        return None
    # Epoch millis (HubSpot sometimes serialises createdate this way).
    if s.isdigit():
        try:
            return datetime.fromtimestamp(int(s) / 1000, tz=timezone.utc)
        except (ValueError, OSError):
            return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def load_roster(sb: Client) -> tuple[dict[str, dict], list[dict]]:
    """(owner_id -> team row, all roster rows). Ordered so the receiver pool is
    stable run to run (deterministic target pick lives in pick_target)."""
    rows = (sb.table("reassignment_teams").select("*")
            .order("open_border_group").order("team").execute().data) or []
    by_owner = {}
    for r in rows:
        oid = str(r.get("hubspot_owner_id") or "").strip()
        if oid:
            by_owner[oid] = r
    return by_owner, rows


def load_candidates(sb: Client) -> list[dict]:
    """Deal rows in a qualifying stage with zero calls (paginated)."""
    cols = ("deal_id, deal_name, current_stage, hubspot_owner_id, num_calls, "
            "hs_createdate, last_reassigned_at, reassign_visited, reassign_hops")
    out, page = [], 1000
    frm = 0
    while True:
        q = (sb.table("hs_deal_state").select(cols)
             .in_("current_stage", QUALIFYING_STAGES)
             .or_("num_calls.eq.0,num_calls.is.null")
             .range(frm, frm + page - 1))
        data = q.execute().data or []
        out.extend(data)
        if len(data) < page:
            break
        frm += page
    return out


def recently_logged(sb: Client, since: datetime) -> set[str]:
    """deal_ids already logged (any status) since `since` — daily dedupe."""
    rows = (sb.table("lead_reassignments")
            .select("deal_id, evaluated_at")
            .gte("evaluated_at", since.isoformat())
            .execute().data or [])
    return {str(r.get("deal_id")) for r in rows if r.get("deal_id")}


def pick_target(group_teams: list[dict], from_owner: str, visited: set[str],
                rng: random.Random):
    """Random eligible receiver in the same open-border group.
    Eligible = can_receive, active, has an owner id, not the current owner,
    and has never held this deal. `rng` is a per-deal local RNG so the choice
    is stable run to run without touching global random state. Returns a team
    row or None."""
    pool = [
        t for t in group_teams
        if t.get("can_receive") and t.get("active")
        and str(t.get("hubspot_owner_id") or "").strip()
        and str(t.get("hubspot_owner_id")) != str(from_owner)
        and str(t.get("hubspot_owner_id")) not in visited
    ]
    if not pool:
        return None
    return rng.choice(pool)


def hs_patch_owner(sess, object_type: str, object_id: str, owner_id: str):
    """Live HubSpot owner PATCH. Only reached in armed --apply mode."""
    time.sleep(THROTTLE_S)
    r = sess.patch(
        f"{HS_API}/crm/v3/objects/{object_type}/{object_id}",
        json={"properties": {"hubspot_owner_id": str(owner_id)}},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def fetch_deal_contacts(sess, deal_id: str) -> list[str]:
    """Contact ids associated with a deal. Armed --apply mode only."""
    time.sleep(THROTTLE_S)
    r = sess.get(f"{HS_API}/crm/v4/objects/deals/{deal_id}/associations/contacts",
                 timeout=30)
    r.raise_for_status()
    return [str(x.get("toObjectId")) for x in (r.json().get("results") or [])
            if x.get("toObjectId")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="attempt live HubSpot writes (also needs REASSIGN_ARM=1)")
    args = ap.parse_args()

    armed = args.apply and os.environ.get("REASSIGN_ARM", "").strip() == "1"
    dry_run = not armed
    mode = "LIVE (armed)" if armed else "DRY-RUN (no HubSpot writes)"
    print(f"→ reassignment evaluator — {mode}")

    sb = supabase_client()
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=IDLE_HOURS)

    by_owner, roster = load_roster(sb)
    # Group teams by open-border area for target selection.
    by_group: dict[str, list[dict]] = {}
    for t in roster:
        by_group.setdefault(t.get("open_border_group"), []).append(t)

    candidates = load_candidates(sb)
    skip_ids = recently_logged(sb, now - timedelta(hours=DEDUPE_HOURS))
    print(f"  roster: {len(roster)} teams · candidates (stage+0 calls): {len(candidates)} "
          f"· deduped-out (logged <{DEDUPE_HOURS}h): {len(skip_ids)}")

    audit_rows = []
    would_move = 0
    sess = None
    if armed:
        sess = requests.Session()
        sess.headers.update({"Authorization": f"Bearer {_need('HUBSPOT_TOKEN')}",
                             "Content-Type": "application/json"})

    for d in candidates:
        did = str(d.get("deal_id") or "")
        if not did or did in skip_ids:
            continue
        from_owner = str(d.get("hubspot_owner_id") or "").strip()
        team = by_owner.get(from_owner)
        # Owner must map to a participating, can_originate, active team.
        if not team or not team.get("can_originate") or not team.get("active"):
            continue

        # 72h clock: max(hs_createdate, last_reassigned_at). Unknown → skip
        # (waits for the next sync to backfill hs_createdate).
        origin = max(
            [dt for dt in (_parse_ts(d.get("hs_createdate")),
                           _parse_ts(d.get("last_reassigned_at"))) if dt],
            default=None,
        )
        if origin is None or origin > cutoff:
            continue  # no clock yet, or not idle 72h

        group = team.get("open_border_group")
        # A team with no open-border group must never move a deal (it would
        # land in the null bucket and cross unrelated areas). Skip loudly.
        if not group:
            audit_rows.append({
                "deal_id": did, "deal_name": d.get("deal_name"),
                "from_owner_id": from_owner, "from_team": team.get("team"),
                "hop": int(d.get("reassign_hops") or 0) + 1,
                "dry_run": dry_run, "evaluated_at": now.isoformat(),
                "status": "skipped", "error": "originating team has no open_border_group",
            })
            continue
        visited = set(str(x) for x in (d.get("reassign_visited") or []))
        visited.add(from_owner)
        # Per-deal local RNG (seeded by deal) → stable pick day to day without
        # clobbering the process-global random state.
        rng = random.Random(f"{did}:{group}")
        target = pick_target(by_group.get(group, []), from_owner, visited, rng)

        base = {
            "deal_id": did,
            "deal_name": d.get("deal_name"),
            "open_border_group": group,
            "from_owner_id": from_owner,
            "from_team": team.get("team"),
            "clock_origin": origin.isoformat(),
            "deal_created_at": (_parse_ts(d.get("hs_createdate")) or origin).isoformat(),
            "hop": int(d.get("reassign_hops") or 0) + 1,
            "dry_run": dry_run,
            "evaluated_at": now.isoformat(),
        }

        if target is None:
            audit_rows.append({**base, "status": "skipped",
                               "error": "no eligible receiver in group"})
            continue

        to_owner = str(target.get("hubspot_owner_id"))
        row = {**base, "to_owner_id": to_owner, "to_team": target.get("team")}
        would_move += 1

        if armed:
            # Order matters for bounce-safety: (1) move the deal, (2) persist
            # the clock-reset + visited to Supabase BEFORE anything else so the
            # deal can't be re-picked on the next run even if a later step
            # fails, (3) best-effort patch contact owners. The deal move is the
            # only thing that can fail the whole record; contacts are additive.
            try:
                hs_patch_owner(sess, "deals", did, to_owner)
            except Exception as e:  # noqa: BLE001 — log & continue, never abort the batch
                row.update({"status": "error", "deal_patched": False,
                            "error": f"deal patch failed: {str(e)[:400]}"})
                audit_rows.append(row)
                continue

            # (2) Persist state, retried — this is what prevents a re-bounce.
            state_err = None
            for attempt in range(3):
                try:
                    sb.table("hs_deal_state").update({
                        "hubspot_owner_id": to_owner,
                        "last_reassigned_at": now.isoformat(),
                        "reassign_hops": row["hop"],
                        "reassign_visited": list(visited | {to_owner}),
                    }).eq("deal_id", did).execute()
                    state_err = None
                    break
                except Exception as e:  # noqa: BLE001
                    state_err = str(e)[:300]
                    time.sleep(1)

            # (3) Best-effort contact-owner patching (docstring promises both).
            contacts_patched = 0
            try:
                for cid in fetch_deal_contacts(sess, did):
                    try:
                        hs_patch_owner(sess, "contacts", cid, to_owner)
                        contacts_patched += 1
                    except Exception:  # noqa: BLE001 — one bad contact must not sink the move
                        pass
            except Exception:  # noqa: BLE001 — association lookup failure is non-fatal
                pass

            # Deal DID move, so status stays applied even if state/contacts
            # were partial; surface any state-persist failure in the error col.
            row.update({"status": "applied", "deal_patched": True,
                        "contacts_patched": contacts_patched})
            if state_err:
                row["error"] = f"deal+contacts moved but state not persisted: {state_err}"
        else:
            row.update({"status": "dry_run", "deal_patched": False,
                        "contacts_patched": 0})

        audit_rows.append(row)

    if audit_rows:
        for i in range(0, len(audit_rows), 500):
            sb.table("lead_reassignments").insert(audit_rows[i:i + 500]).execute()
    print(f"  logged {len(audit_rows)} decisions · would-move: {would_move} · applied: "
          f"{sum(1 for r in audit_rows if r.get('status') == 'applied')}")

    # Heartbeat so the dashboard can show when the evaluator last ran.
    sb.table("sync_status").upsert({
        "name": "reassign_eval",
        "last_synced_at": now.isoformat(),
        "ok": True,
        "message": f"{mode}: {would_move} would-move of {len(candidates)} candidates",
    }, on_conflict="name").execute()
    print("✓ done")


if __name__ == "__main__":
    main()
