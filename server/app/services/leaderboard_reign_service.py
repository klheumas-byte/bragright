"""Deterministic #1 history derived only from authoritative completed matches."""

import logging
from datetime import datetime, timezone

from ..db import get_leaderboard_reigns_collection, get_matches_collection, get_users_collection
from .competitive_service import _apply_match_to_stats


LOGGER = logging.getLogger(__name__)


def _as_utc(value):
    """Normalize PyMongo's naive UTC datetimes and already-aware values."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def reconstruct_reigns(users, matches, *, now=None):
    """Return leader-change reigns using the same ranking points/tie-breaks as ranking."""
    now = _as_utc(now or datetime.now(timezone.utc))
    players = [u for u in users if str(u.get("role") or "player") == "player" and u.get("status") != "disabled"]
    names = {str(u["_id"]): u.get("username") or "Player" for u in players}
    counters = {pid: {"total_matches": 0, "wins": 0, "losses": 0, "draws": 0, "points": 0} for pid in names}
    authoritative = []
    for match in matches:
        confirmed_at = match.get("confirmed_at")
        if match.get("status") != "confirmed" or not isinstance(confirmed_at, datetime):
            continue
        normalized_match = dict(match)
        normalized_match["confirmed_at"] = _as_utc(confirmed_at)
        authoritative.append(normalized_match)
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
        # PyMongo mutates inserted dictionaries by attaching ObjectIds. Persist
        # copies so the deterministic domain records remain safe to serialize.
        collection.insert_many([dict(reign) for reign in reigns])
    return reigns


def refresh_reigns_after_mutation(config, logger=None):
    """Refresh derived history without misreporting an already-committed action."""
    log = logger or LOGGER
    try:
        return refresh_reigns(config, log)
    except Exception:
        log.exception("Leaderboard reign refresh failed after a committed match update")
        return None


def reign_summary(reigns, *, now=None):
    now = _as_utc(now or datetime.now(timezone.utc))
    completed = [dict(item) for item in reigns]
    for item in completed:
        item["started_at"] = _as_utc(item["started_at"])
        if item.get("ended_at") is not None:
            item["ended_at"] = _as_utc(item["ended_at"])
        if item.get("ended_at") is None:
            item["duration_seconds"] = max(0, int((now - item["started_at"]).total_seconds()))
    totals = {}
    for item in completed:
        totals[item["player_id"]] = totals.get(item["player_id"], 0) + item["duration_seconds"]
    return {"current": completed[-1] if completed else None, "reigns": completed, "total_seconds_by_player": totals}
