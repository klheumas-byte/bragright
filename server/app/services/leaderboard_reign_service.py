"""Deterministic #1 history derived only from authoritative completed matches."""

from datetime import datetime, timezone

from ..db import get_leaderboard_reigns_collection, get_matches_collection, get_users_collection
from .competitive_service import _apply_match_to_stats


def reconstruct_reigns(users, matches, *, now=None):
    """Return leader-change reigns using the same ranking points/tie-breaks as ranking."""
    now = now or datetime.now(timezone.utc)
    players = [u for u in users if str(u.get("role") or "player") == "player" and u.get("status") != "disabled"]
    names = {str(u["_id"]): u.get("username") or "Player" for u in players}
    counters = {pid: {"total_matches": 0, "wins": 0, "losses": 0, "draws": 0, "points": 0} for pid in names}
    authoritative = [m for m in matches if m.get("status") == "confirmed" and isinstance(m.get("confirmed_at"), datetime)]
    authoritative.sort(key=lambda m: (m["confirmed_at"], str(m.get("_id") or "")))
    reigns, leader_id = [], None
    for match in authoritative:
        _apply_match_to_stats(counters, match)
        current = min(counters, key=lambda pid: (-counters[pid]["points"], -counters[pid]["wins"], names[pid].casefold(), pid)) if counters else None
        if current == leader_id:
            continue
        at = match["confirmed_at"]
        if reigns:
            reigns[-1]["ended_at"] = at
            reigns[-1]["duration_seconds"] = max(0, int((at - reigns[-1]["started_at"]).total_seconds()))
            reigns[-1]["next_leader_id"] = current
        reigns.append({"player_id": current, "position": 1, "started_at": at, "ended_at": None, "duration_seconds": max(0, int((now - at).total_seconds())), "previous_leader_id": leader_id, "next_leader_id": None})
        leader_id = current
    return reigns


def refresh_reigns(config, logger=None):
    users = list(get_users_collection(config=config, logger=logger).find({}, {"username": 1, "role": 1, "status": 1}))
    matches = list(get_matches_collection(config=config, logger=logger).find({"status": "confirmed"}))
    reigns = reconstruct_reigns(users, matches)
    collection = get_leaderboard_reigns_collection(config=config, logger=logger)
    collection.delete_many({"position": 1})
    if reigns:
        collection.insert_many(reigns)
    return reigns


def reign_summary(reigns, *, now=None):
    now = now or datetime.now(timezone.utc)
    completed = [dict(item) for item in reigns]
    for item in completed:
        if item.get("ended_at") is None:
            item["duration_seconds"] = max(0, int((now - item["started_at"]).total_seconds()))
    totals = {}
    for item in completed:
        totals[item["player_id"]] = totals.get(item["player_id"], 0) + item["duration_seconds"]
    return {"current": completed[-1] if completed else None, "reigns": completed, "total_seconds_by_player": totals}
